/**
 * The Assistant on the Claude subscription end to end, with no Claude account: the real engine, the
 * adapter's real process (process.ts) running the fake agent (apps/desktop/tests/fake-claude-agent.mjs)
 * with this test's Node, the real per-chat MCP endpoint, and Sonobe's MCP tools over a headless host
 * on a temp project that stands in for the app's canvas (it takes preview_design's drafts, and its
 * capture window reads every page as the checkout below).
 */

import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHeadlessHost, type CapturedDesign, type DesignPreviewUpdate, type HeadlessHost } from "@sonobe/mcp";
import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssistantCanvasContext, AssistantEvent, AssistantSendRequest } from "../protocol.ts";
import { createMcpToolBridge, type ToolBridge } from "../toolBridge.ts";
import { createSubscriptionAgent, RESTARTED, type SubscriptionAgent } from "./engine.ts";
import { locateClaudeAgent } from "./locate.ts";
import { CLAUDE_AGENT_ENV } from "./types.ts";

const FAKE = fileURLToPath(new URL("../../../tests/fake-claude-agent.mjs", import.meta.url));

/** The fake agent's checkout page as the capture window would read it (no browser in tests). */
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
      { kind: "text", name: "Header", text: "Checkout", box: [20, 62, 362, 41], style: { fontFamily: "system-ui", fontSize: 34, fontWeight: 700, color: "#111118FF", lineHeight: 41 } },
      { kind: "text", name: "Total", text: "Total $48.00", box: [24, 300, 354, 28], style: { fontFamily: "system-ui", fontSize: 20, fontWeight: 600, color: "#111118FF", lineHeight: 28 } },
      { kind: "frame", name: "Pay Button", box: [20, 788, 362, 52], fill: "#000000FF", radii: [14, 14, 14, 14], children: [] },
    ],
  },
  images: {},
};

let dir: string;
let logFile: string;
let host: HeadlessHost;
let bridge: ToolBridge;
let agent: SubscriptionAgent;
let docId: string;
let previews: DesignPreviewUpdate[];
let events: AssistantEvent[];

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sonobe-subscription-"));
  logFile = path.join(dir, "fake.log.jsonl");
  previews = [];
  events = [];
  host = createHeadlessHost({ registry: createPatchRegistry() });
  await host.createDocument({ path: path.join(dir, "Noddit.sonobe"), template: "photo-zoom" });
  docId = (await host.getDocument()).docId;
  // The app's canvas: it draws preview_design's drafts, and its capture window reads the page.
  const canvas = Object.create(host) as HeadlessHost;
  Object.defineProperty(canvas, "capabilities", { value: { ...host.capabilities, designPreview: true } });
  Object.defineProperty(canvas, "showDesignPreview", { value: async (update: DesignPreviewUpdate) => void previews.push(structuredClone(update)) });
  Object.defineProperty(canvas, "captureDesign", { value: async (): Promise<CapturedDesign> => ({ capture: CHECKOUT_CAPTURE as never, images: new Map() }) });
  bridge = createMcpToolBridge({ host: canvas, version: "0.1.0-test", hidden: new Map() });
  agent = createSubscriptionAgent({
    tools: () => bridge,
    version: "0.1.0-test",
    sessionsDir: path.join(dir, "assistant", "claude"),
    locate: () => locateClaudeAgent({ env: { [CLAUDE_AGENT_ENV]: FAKE }, execPath: process.execPath }),
    env: { ...process.env, FAKE_CLAUDE_LOG: logFile },
    documentFor: async () => ({ docId, projectPath: path.join(dir, "Noddit.sonobe") }),
    readDocument: async (id) => (await host.getDocument(id)).doc,
    platform: "darwin",
  });
});

afterEach(async () => {
  await agent.dispose();
  await bridge.close();
  await host.close();
  await rm(dir, { recursive: true, force: true });
});

const send = (text: string, extra: Partial<AssistantSendRequest> = {}, onEvent?: (event: AssistantEvent) => void) =>
  agent.run("w1", { text, ...extra }, (event) => {
    events.push(event);
    onEvent?.(event);
  });

const ofType = <T extends AssistantEvent["type"]>(type: T) => events.filter((e): e is Extract<AssistantEvent, { type: T }> => e.type === type);
const reply = () => ofType("text_delta").map((e) => e.delta).join("");

/** What the fake logged, one object per line. */
async function fakeLog(): Promise<{ kind: string; [key: string]: unknown }[]> {
  if (!existsSync(logFile)) return [];
  return (await readFile(logFile, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { kind: string });
}

const CONTEXT: AssistantCanvasContext = { component: { id: "main", name: "Main", size: [402, 874] }, screens: [{ id: "photo", name: "Photo" }] };

describe("the Assistant on the Claude subscription, over the fake agent", () => {
  it("designs a screen from the canvas box: it draws live through preview_design, then imports it into the window's document as the Assistant", async () => {
    const result = await send("a checkout screen", { context: CONTEXT });
    expect(result.outcome, JSON.stringify(events.filter((e) => e.type === "tool_finished" || e.type === "run_finished"))).toBe("completed");
    expect(reply()).toBe("I'll design a checkout screen that matches your prototype.Added a checkout screen with Apple Pay and a promo code. Try “Make it interactive” next.");

    expect([...new Set(ofType("tool_started").map((e) => e.toolUseId))]).toHaveLength(5);
    expect([...new Set(ofType("tool_started").map((e) => e.name))]).toEqual(["get_outline", "preview_design", "import_design"]);
    const finished = ofType("tool_finished");
    expect(finished.map((e) => [e.name, e.status])).toEqual([
      ["get_outline", "done"],
      ["preview_design", "done"],
      ["preview_design", "done"],
      ["preview_design", "done"],
      ["import_design", "done"],
    ]);
    const imported = finished.at(-1)!.imported!;
    expect(imported).toMatchObject({ docId, name: "Checkout", replaced: null });

    // Drawn live: the draft grew call by call over the component the box shows, then became layers.
    const writing = previews.filter((p) => p.status === "writing");
    expect(writing).toHaveLength(3);
    expect(writing.every((p) => p.author.name === "Assistant" && p.component === "main" && p.name === "Checkout" && p.docId === docId)).toBe(true);
    expect(writing.map((p) => p.html!.length)).toEqual([...writing.map((p) => p.html!.length)].sort((a, b) => a - b));
    expect(writing.at(-1)!.html).toContain('data-name="Pay Button"');
    expect(previews.map((p) => p.status).slice(-2)).toEqual(["adding", "cleared"]);

    const snap = await host.getDocument(docId);
    const screen = snap.doc.components.main!.layers.find((l) => l.id === imported.screenId)!;
    expect(screen.name).toBe("Checkout");
    expect(screen.children?.map((l) => l.name)).toEqual(["Header", "Total", "Pay Button"]);
    expect((await host.history.list({ limit: 1 }))[0]?.author).toEqual({ kind: "agent", name: "Assistant" });

    // The session the fake got: isolated, with Sonobe's tools and prompt, and asking before a save.
    const opened = (await fakeLog()).find((l) => l.kind === "session/new") as unknown as { params: { cwd: string; mcpServers: { name: string; headers: { name: string; value: string }[] }[]; _meta: { systemPrompt: string; claudeCode: { options: Record<string, unknown> } } } };
    expect(opened.params.cwd).toBe(path.join(dir, "assistant", "claude"));
    expect(opened.params.mcpServers).toEqual([expect.objectContaining({ type: "http", name: "sonobe", headers: [{ name: "Authorization", value: "<redacted>" }] })]);
    expect(opened.params._meta.systemPrompt).toContain("start with preview_design (component from the context; name; replace for a redesign)");
    expect(opened.params._meta.systemPrompt).toContain("preview_design");
    const options = opened.params._meta.claudeCode.options;
    expect(options).toMatchObject({ tools: [], settingSources: [], persistSession: false, strictMcpConfig: true, model: "claude-sonnet-5", maxTurns: 30, env: { ENABLE_TOOL_SEARCH: "false", MCP_TOOL_TIMEOUT: "1800000", CLAUDE_AGENT_SDK_CLIENT_APP: "sonobe/0.1.0-test" } });
    expect(options.allowedTools).toContain("mcp__sonobe__preview_design");
    expect(options.allowedTools).not.toContain("mcp__sonobe__save_document");
    expect(agent.snapshot("w1").usage).toMatchObject({ inputTokens: 1200, outputTokens: 300, cacheReadTokens: 20_000, estimatedCostUsd: 0 });
  });

  it("asks before replacing a screen the person changed by hand, from the draft's replace", async () => {
    await send("a checkout screen", { context: CONTEXT });
    const screenId = ofType("tool_finished").at(-1)!.imported!.screenId;
    const header = (await host.getDocument(docId)).doc.components.main!.layers.find((l) => l.id === screenId)!.children!.find((l) => l.name === "Header")!;
    await host.apply([{ op: "updateLayer", component: "main", id: header.id, props: { textColor: "#FF0000FF" } }], { label: "Recolor the header", author: { kind: "human", name: "Tyler" } });
    const revision = (await host.getDocument(docId)).revision;

    events = [];
    const result = await send(`replace ${screenId} with a darker checkout`, {}, (e) => {
      if (e.type === "confirm_required") queueMicrotask(() => agent.confirm("w1", e.confirmationId, false));
    });
    expect(result.outcome).toBe("completed");
    expect(ofType("confirm_required")).toEqual([expect.objectContaining({ kind: "replace", title: "Replace your changes to “Checkout”?", approveLabel: "Replace", declineLabel: "Keep my changes" })]);
    expect(ofType("tool_finished").at(-1)).toMatchObject({ name: "import_design", status: "declined", detail: "You kept your changes" });
    expect((await host.getDocument(docId)).revision).toBe(revision);
  });

  it("shows Claude Code's question before a save as a permission card, and passes the choice back", async () => {
    const result = await send("save it", {}, (e) => {
      if (e.type === "confirm_required") queueMicrotask(() => agent.confirm("w1", e.confirmationId, true, "allow-once"));
    });
    expect(result.outcome).toBe("completed");
    const card = ofType("confirm_required")[0]!;
    expect(card).toMatchObject({ kind: "permission", title: "Allow Claude to save this prototype?", count: 0 });
    expect(card.options?.map((o) => o.label)).toEqual(["Allow", "Allow for this chat", "Don't allow"]);
    expect(ofType("confirm_resolved")[0]).toMatchObject({ approved: true, optionId: "allow-once" });
    expect(reply()).toBe("Saved it.");
    expect((await fakeLog()).find((l) => l.kind === "permission")).toMatchObject({ tool: "save_document", optionKind: "allow_once" });

    events = [];
    await send("save it again", {}, (e) => {
      if (e.type === "confirm_required") queueMicrotask(() => agent.confirm("w1", e.confirmationId, false));
    });
    expect(ofType("tool_finished").at(-1)).toMatchObject({ name: "save_document", status: "declined", detail: "You didn't allow it" });
    expect(reply()).toBe("Okay, I won't.");
  });

  it("stops a reply that hangs", async () => {
    const result = await send("hang", {}, (e) => {
      if (e.type === "text_delta") queueMicrotask(() => agent.stop("w1"));
    });
    expect(result.outcome).toBe("stopped");
    expect((await fakeLog()).some((l) => l.kind === "session/cancel")).toBe(true);
    events = [];
    expect((await send("echo hello")).outcome).toBe("completed");
    expect(reply()).toBe("Echo: echo hello");
  });

  it("says the adapter crashed, then restarts it for the next message with a notice", async () => {
    const result = await send("crash");
    expect(result).toMatchObject({ outcome: "error", error: { code: "agent_crashed", message: expect.stringContaining("(exit code 7: fake crash: something broke)") } });
    events = [];
    expect((await send("echo hello")).outcome).toBe("completed");
    expect(ofType("notice").map((n) => n.message)).toEqual([RESTARTED]);
    expect((await fakeLog()).filter((l) => l.kind === "initialize")).toHaveLength(2);
  });

  it("says Claude isn't signed in", async () => {
    expect(await send("signedout")).toMatchObject({ outcome: "error", error: { code: "not_signed_in", message: expect.stringContaining("Choose Sign in") } });
    expect(await agent.checkSubscription()).toMatchObject({ state: "ready", kind: "account", label: "Claude Max", email: "fake@example.com", adapterVersion: "0.0.0-fake" });
  });
});
