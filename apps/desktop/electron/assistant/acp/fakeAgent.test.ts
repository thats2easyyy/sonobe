/**
 * The fake agent (apps/desktop/tests/fake-claude-agent.mjs) really drives Sonobe's MCP tools: it runs
 * over a real Streamable HTTP MCP server (createHttpHandler over a headless host with a fake canvas
 * and capture window), as the app's per-chat endpoint would serve it, and the tests check the
 * document afterwards. So the subscription path's tests exercise real tool calls, not canned ones.
 */

import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestPermissionRequest, SessionNotification } from "@agentclientprotocol/sdk";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createHeadlessHost, createHttpHandler, createSonobeMcpServer, TOOL_NAMES, type CapturedDesign, type DesignCaptureRequest, type DesignPreviewUpdate, type HeadlessHost, type NodeMcpHandler } from "@sonobe/mcp";
import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { locateClaudeAgent } from "./locate.ts";
import { createAcpAgentProcess } from "./process.ts";
import { CLAUDE_AGENT_ENV, type AcpAgentProcess } from "./types.ts";

const FAKE = fileURLToPath(new URL("../../../tests/fake-claude-agent.mjs", import.meta.url));
/** The tools that reach outside the window's prototype, so Claude Code asks first. */
const ASKING = new Set(["save_document", "open_document", "create_document"]);
const ALLOWED = TOOL_NAMES.filter((name) => !ASKING.has(name)).map((name) => `mcp__sonobe__${name}`);
const TOKEN = "test-token-0123456789abcdef";

/** The checkout as the capture window would read the fake's page (there's no browser in tests). */
const CHECKOUT_CAPTURE = {
  format: "sonobe.design-capture",
  version: 1,
  source: { kind: "html", title: "Checkout" },
  viewport: { width: 402, height: 874 },
  root: {
    kind: "frame",
    name: "Checkout",
    box: [0, 0, 402, 874],
    fill: "#F5F5F7FF",
    children: [
      { kind: "frame", name: "Header", box: [20, 62, 362, 41], children: [{ kind: "text", name: "Title", text: "Checkout", box: [20, 62, 160, 41], style: { fontFamily: "system-ui", fontSize: 34, fontWeight: 700, color: "#111118FF", lineHeight: 41 } }] },
      { kind: "frame", name: "Total", box: [24, 700, 354, 24], children: [] },
      { kind: "frame", name: "Pay Button", box: [20, 788, 362, 52], fill: "#000000FF", radii: [14, 14, 14, 14], children: [] },
    ],
  },
  images: {},
};

let dir: string;
let base: HeadlessHost;
let handler: NodeMcpHandler;
let server: Server;
let url: string;
let agent: AcpAgentProcess;
let previews: DesignPreviewUpdate[];
let captures: DesignCaptureRequest[];
/** Each MCP request's Authorization header and JSON-RPC body, as the endpoint got them. */
let requests: { authorization: string | undefined; body: Buffer[] }[];
let logFile: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sonobe-fake-agent-"));
  previews = [];
  captures = [];
  requests = [];
  logFile = path.join(dir, "fake.log.jsonl");
  base = createHeadlessHost({ registry: createPatchRegistry() });
  await base.createDocument({ path: path.join(dir, "Shop.sonobe"), template: "photo-zoom" });

  // The app's canvas and capture window, as fakes: drafts are recorded, pages read as CHECKOUT_CAPTURE.
  const host = Object.create(base) as HeadlessHost;
  Object.defineProperty(host, "capabilities", { value: { ...base.capabilities, designPreview: true } });
  Object.defineProperty(host, "showDesignPreview", { value: async (update: DesignPreviewUpdate) => void previews.push(structuredClone(update)) });
  Object.defineProperty(host, "captureDesign", {
    value: async (request: DesignCaptureRequest): Promise<CapturedDesign> => {
      captures.push(request);
      return { capture: CHECKOUT_CAPTURE as never, images: new Map() };
    },
  });
  handler = createHttpHandler(host, { version: "0.1.0-test" });
  server = createServer((req, res) => {
    const seen = { authorization: req.headers.authorization, body: [] as Buffer[] };
    requests.push(seen);
    // Keep a copy of the body as the handler reads it.
    const read = req[Symbol.asyncIterator].bind(req);
    Object.defineProperty(req, Symbol.asyncIterator, {
      value: async function* () {
        for await (const chunk of read()) {
          seen.body.push(Buffer.from(chunk as Buffer));
          yield chunk;
        }
      },
    });
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;

  agent = startAgent();
});

/** The fake agent's process, with `env` added to this test's. */
function startAgent(env: Record<string, string> = {}): AcpAgentProcess {
  const found = locateClaudeAgent({ env: { [CLAUDE_AGENT_ENV]: FAKE } });
  if (!found.ok) throw new Error(`The fake agent isn't at ${FAKE}.`);
  return createAcpAgentProcess({ spec: found.spec, cwd: path.join(dir, "claude"), baseEnv: { ...process.env, FAKE_CLAUDE_LOG: logFile, ...env }, clientVersion: "0.1.0-test" });
}

/** Swap the agent for one started with `env` (FAKE_CLAUDE_MODE, say). */
async function restartAgent(env: Record<string, string>): Promise<void> {
  await agent.dispose();
  agent = startAgent(env);
}

afterEach(async () => {
  await agent.dispose();
  await handler.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await base.close();
  await rm(dir, { recursive: true, force: true });
});

/** A session as the subscription engine opens one: Sonobe's endpoint with its bearer token, and Claude Code's options. */
async function openSession(): Promise<{ sessionId: string; updates: SessionNotification["update"][] }> {
  const { sessionId } = await agent.newSession({
    cwd: path.join(dir, "claude"),
    mcpServers: [{ type: "http", name: "sonobe", url, headers: [{ name: "Authorization", value: `Bearer ${TOKEN}` }] }],
    _meta: {
      systemPrompt: "You are Sonobe's Assistant.",
      claudeCode: { options: { tools: [], settingSources: [], persistSession: false, strictMcpConfig: true, model: "claude-sonnet-5", maxTurns: 30, allowedTools: ALLOWED, env: { ENABLE_TOOL_SEARCH: "false" } } },
    },
  });
  const updates: SessionNotification["update"][] = [];
  agent.onSessionUpdate(sessionId, (n) => updates.push(n.update));
  return { sessionId, updates };
}

const ask = (sessionId: string, ...texts: string[]) => agent.prompt({ sessionId, prompt: texts.map((text) => ({ type: "text" as const, text })) });

const contextBlock = (target: { id: string; name: string } | null = null) =>
  ["<canvas_context>", "Sent from the Design with Claude box on the canvas.", JSON.stringify({ component: { id: "main", name: "Main", size: [402, 874] }, screens: [], target, codeFolder: null }), "</canvas_context>"].join("\n");

const textOf = (updates: SessionNotification["update"][]) =>
  updates.map((u) => (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text" ? u.content.text : "")).join("");

/** The tools the fake called, in order, from its tool_call updates. */
const toolsOf = (updates: SessionNotification["update"][]) => updates.flatMap((u) => (u.sessionUpdate === "tool_call" ? [u.title.replace(/^mcp__sonobe__/, "")] : []));

/** The endpoint's tools/call requests: name, arguments and _meta. */
const toolCalls = () =>
  requests
    .map((r) => Buffer.concat(r.body).toString("utf8"))
    .filter(Boolean)
    .map((body) => JSON.parse(body) as { method?: string; params?: { name: string; arguments: Record<string, unknown>; _meta?: Record<string, unknown> } })
    .filter((rpc) => rpc.method === "tools/call")
    .map((rpc) => rpc.params!);

async function fakeLog(): Promise<{ kind: string; [key: string]: unknown }[]> {
  if (!existsSync(logFile)) return [];
  return (await readFile(logFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
}

/** A tool call on the headless host through an MCP client of its own. */
async function sonobe(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const mcp = createSonobeMcpServer(base, { version: "0.1.0-test" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverSide);
  const client = new Client({ name: "test", version: "0.1.0-test" });
  await client.connect(clientSide);
  try {
    const result = await client.callTool({ name, arguments: args });
    return (result.content as { type: string; text?: string }[]).map((c) => c.text ?? "").join("\n");
  } finally {
    await client.close();
    await mcp.close();
  }
}

async function rootLayers() {
  const { doc } = await base.getDocument();
  return doc.components[doc.project.root]!.layers;
}

describe("the fake Claude agent over Sonobe's MCP tools", () => {
  it("designs a checkout on the canvas from a canvas context: previews it part by part, then imports it", async () => {
    const { sessionId, updates } = await openSession();
    const result = await ask(sessionId, contextBlock(), "A checkout screen");
    expect(result.stopReason).toBe("end_turn");
    expect(toolsOf(updates)).toEqual(["get_outline", "preview_design", "preview_design", "preview_design", "import_design"]);
    expect(textOf(updates)).toBe("I'll design a checkout screen that matches your prototype.Added a checkout screen with Apple Pay and a promo code. Try “Make it interactive” next.");
    // A new messageId after the tools: the text after a tool result is a new model response.
    const ids = updates.flatMap((u) => (u.sessionUpdate === "agent_message_chunk" ? [u.messageId] : []));
    expect(new Set(ids).size).toBe(2);
    // Every tool finished, and each call carried its chip's id the way Claude Code sends it.
    const finished = updates.filter((u) => u.sessionUpdate === "tool_call_update" && u.status);
    expect(finished.map((u) => (u as { status: string }).status)).toEqual(["completed", "completed", "completed", "completed", "completed"]);
    const calls = toolCalls();
    const chipIds = updates.flatMap((u) => (u.sessionUpdate === "tool_call" ? [u.toolCallId] : []));
    expect(calls.map((c) => [c.name, c._meta?.["claudecode/toolUseId"]])).toEqual(toolsOf(updates).map((name, i) => [name, chipIds[i]]));
    expect(calls.every((c) => c._meta?.progressToken !== undefined)).toBe(true);
    expect(calls[1]!.arguments).toMatchObject({ name: "Checkout", component: "main" });
    expect(calls[1]!.arguments).not.toHaveProperty("replace");
    expect(requests.every((r) => r.authorization === `Bearer ${TOKEN}`)).toBe(true);

    // The canvas drew the draft growing, then the import took it: one page, with the layers named.
    const writing = previews.filter((p) => p.status === "writing");
    expect(writing).toHaveLength(3);
    expect(writing.map((p) => p.html!.length)).toEqual([...writing.map((p) => p.html!.length)].sort((a, b) => a - b));
    expect(writing[0]).toMatchObject({ name: "Checkout", component: "main", replace: null });
    const page = captures[0]!.html!;
    expect(captures).toHaveLength(1);
    expect(page).toBe(writing.at(-1)!.html);
    expect(page).toMatch(/^<!doctype html>/);
    expect(page.trimEnd().endsWith("</html>")).toBe(true);
    for (const name of ["Checkout", "Header", "Total", "Pay Button"]) expect(page).toContain(`data-name="${name}"`);
    expect(page).toContain("width=402");
    expect(previews.at(-1)!.status).toBe("cleared");

    const checkout = (await rootLayers()).find((l) => l.name === "Checkout");
    expect(checkout?.children?.map((l) => l.name)).toEqual(["Header", "Total", "Pay Button"]);
    const [latest] = await base.history.list({ limit: 1 });
    expect(latest?.author.kind).toBe("agent");
  }, 20_000);

  it("wires a working press on the Pay button, with nothing for get_diagnostics to flag", async () => {
    const { sessionId, updates } = await openSession();
    await ask(sessionId, "design a checkout");
    const before = updates.length;
    expect((await ask(sessionId, "Make it interactive")).stopReason).toBe("end_turn");
    const wiring = updates.slice(before);
    expect(toolsOf(wiring)).toEqual(["get_outline", "add_patches"]);
    expect(textOf(wiring)).toBe("Wired a tap on “Pay”.");

    const pay = (await rootLayers()).find((l) => l.name === "Checkout")!.children!.find((l) => l.name === "Pay Button")!;
    const outline = await sonobe("get_outline", { detail: "compact" });
    expect(outline).toContain(`patch pay_pressed interaction "Pay Pressed" layer=@${pay.id}`);
    expect(outline).toMatch(new RegExp(`layer ${pay.id} \\S+ "Pay Button" scale←pay_press_scale\\.output`));
    expect(await sonobe("get_diagnostics")).toMatch(/^No diagnostics at revision \d+\.$/);
  }, 20_000);

  it("asks before save_document, and saves once the person allows it", async () => {
    const { sessionId, updates } = await openSession();
    const asked: RequestPermissionRequest[] = [];
    agent.setPermissionHandler(sessionId, async (request) => {
      asked.push(request);
      // Nothing has reached Sonobe yet.
      expect(toolCalls().map((c) => c.name)).toEqual([]);
      return { outcome: { outcome: "selected", optionId: "allow-once" } };
    });
    expect((await ask(sessionId, "save my prototype")).stopReason).toBe("end_turn");
    expect(asked).toHaveLength(1);
    expect(asked[0]!.toolCall).toMatchObject({ toolCallId: expect.stringMatching(/^toolu_fake_/), name: "mcp__sonobe__save_document", rawInput: {} });
    expect(toolCalls().map((c) => c.name)).toEqual(["save_document"]);
    expect(updates.find((u) => u.sessionUpdate === "tool_call_update" && u.status)).toMatchObject({ status: "completed" });
    expect(textOf(updates)).toBe("Saved it.");
    expect((await fakeLog()).find((l) => l.kind === "mcp_result")).toMatchObject({ tool: "save_document", isError: false });

    // Declined: the call never reaches Sonobe.
    agent.setPermissionHandler(sessionId, async () => ({ outcome: { outcome: "selected", optionId: "reject" } }));
    await ask(sessionId, "save it again");
    expect(toolCalls().map((c) => c.name)).toEqual(["save_document"]);
    expect(textOf(updates)).toBe("Saved it.Okay, I won't.");
  }, 20_000);

  it("stops asking in that session once the person allows it for the chat", async () => {
    const { sessionId } = await openSession();
    let asked = 0;
    agent.setPermissionHandler(sessionId, async () => {
      asked++;
      return { outcome: { outcome: "selected", optionId: "allow-with-updates" } };
    });
    await ask(sessionId, "save");
    await ask(sessionId, "save");
    expect(asked).toBe(1);
    expect(toolCalls().map((c) => c.name)).toEqual(["save_document", "save_document"]);
  }, 20_000);

  it("in auto mode, calls save_document without asking, as Claude Code does when the person's own default is auto", async () => {
    await restartAgent({ FAKE_CLAUDE_MODE: "auto" });
    const { sessionId, updates } = await openSession();
    let asked = 0;
    agent.setPermissionHandler(sessionId, async () => (asked++, { outcome: { outcome: "selected", optionId: "reject" } }));
    expect((await ask(sessionId, "save my prototype")).stopReason).toBe("end_turn");
    expect(asked).toBe(0);
    // Still announced first, so the endpoint can match the call to its chip.
    const chips = updates.flatMap((u) => (u.sessionUpdate === "tool_call" ? [u.toolCallId] : []));
    expect(toolCalls().map((c) => [c.name, c._meta?.["claudecode/toolUseId"]])).toEqual([["save_document", chips[0]]]);
    expect(textOf(updates)).toBe("Saved it.");
    expect((await fakeLog()).filter((l) => l.kind === "unasked").map((l) => [l.tool, l.mode])).toEqual([["save_document", "auto"]]);
  }, 20_000);

  it("in plan mode, runs the read-only get_outline but refuses preview_design, which changes the canvas", async () => {
    await restartAgent({ FAKE_CLAUDE_MODE: "plan" });
    const { sessionId, updates } = await openSession();
    expect((await ask(sessionId, contextBlock(), "A checkout screen")).stopReason).toBe("end_turn");
    expect(toolCalls().map((c) => c.name)).toEqual(["get_outline"]);
    expect(toolsOf(updates)).toEqual(["get_outline", "preview_design"]);
    expect(updates.filter((u) => u.sessionUpdate === "tool_call_update" && u.status).map((u) => (u as { status: string }).status)).toEqual(["completed", "failed"]);
    expect(textOf(updates)).toBe("I'll design a checkout screen that matches your prototype.I'm in plan mode, so I didn't change anything.");
    expect(previews).toEqual([]);
    expect((await fakeLog()).find((l) => l.kind === "plan_refused")).toMatchObject({ tool: "preview_design" });
  }, 20_000);

  it("redesigns a screen with replace <id>: the draft draws over it and the import replaces it", async () => {
    const { sessionId } = await openSession();
    await ask(sessionId, contextBlock(), "A checkout screen");
    const screen = (await rootLayers()).find((l) => l.name === "Checkout")!;
    const count = (await rootLayers()).length;
    previews = [];
    await ask(sessionId, `replace ${screen.id} with a darker one`);
    expect(toolCalls().filter((c) => c.name === "preview_design").at(-3)!.arguments).toMatchObject({ name: "Checkout", replace: screen.id });
    expect(previews.find((p) => p.status === "writing")).toMatchObject({ replace: screen.id });
    expect(toolCalls().at(-1)).toMatchObject({ name: "import_design", arguments: { preview: true } });
    expect((await rootLayers()).length).toBe(count);
    expect((await rootLayers()).filter((l) => l.name === "Checkout").map((l) => l.id)).toEqual([screen.id]);
    expect((await fakeLog()).filter((l) => l.kind === "mcp_result" && l.tool === "import_design").map((l) => l.isError)).toEqual([false, false]);
  }, 20_000);

  it("logs what session/new carried, with the endpoint's token left out", async () => {
    await openSession();
    const created = (await fakeLog()).find((l) => l.kind === "session/new") as { params: Record<string, unknown> } | undefined;
    expect(created?.params).toMatchObject({
      mcpServers: [{ type: "http", name: "sonobe", url, headers: [{ name: "Authorization", value: "<redacted>" }] }],
      _meta: { systemPrompt: "You are Sonobe's Assistant.", claudeCode: { options: { tools: [], settingSources: [], persistSession: false, strictMcpConfig: true, model: "claude-sonnet-5", allowedTools: ALLOWED } } },
    });
    expect(await readFile(logFile, "utf8")).not.toContain(TOKEN);
  });
});
