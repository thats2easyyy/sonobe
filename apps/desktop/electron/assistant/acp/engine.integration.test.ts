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
import { createSubscriptionAgent, MODE_NOT_SET, RATE_LIMITED, RESTARTED, SESSION_ENDED, type SubscriptionAgent } from "./engine.ts";
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
  agent = startAgent();
});

/** The engine over the fake agent, with `env` added to the fake's environment; `shows` names the document each window shows (default: the one document). */
function startAgent(env: Record<string, string> = {}, shows?: (windowId: string) => string): SubscriptionAgent {
  return createSubscriptionAgent({
    tools: () => bridge,
    version: "0.1.0-test",
    sessionsDir: path.join(dir, "assistant", "claude"),
    locate: () => locateClaudeAgent({ env: { [CLAUDE_AGENT_ENV]: FAKE }, execPath: process.execPath }),
    env: { ...process.env, FAKE_CLAUDE_LOG: logFile, ...env },
    documentFor: async (windowId) => (shows ? { docId: shows(windowId), projectPath: null } : { docId, projectPath: path.join(dir, "Noddit.sonobe") }),
    readDocument: async (id) => (await host.getDocument(id)).doc,
    platform: "darwin",
  });
}

/** Start over with the fake in another environment, or with windows that show other documents. */
async function restartAgent(env: Record<string, string>, shows?: (windowId: string) => string) {
  await agent.dispose();
  agent = startAgent(env, shows);
}

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
    expect(options).toMatchObject({ tools: [], settingSources: [], persistSession: false, strictMcpConfig: true, allowDangerouslySkipPermissions: false, model: "claude-sonnet-5", maxTurns: 30, env: { ENABLE_TOOL_SEARCH: "false", MCP_TOOL_TIMEOUT: "1800000", CLAUDE_AGENT_SDK_CLIENT_APP: "sonobe/0.1.0-test" } });
    expect(options.allowedTools).toContain("mcp__sonobe__preview_design");
    expect(options.allowedTools).not.toContain("mcp__sonobe__save_document");
    expect(agent.snapshot("w1").usage).toMatchObject({ inputTokens: 1200, outputTokens: 300, cacheReadTokens: 20_000, estimatedCostUsd: 0 });
  });

  it("keeps each window's design in its own window's prototype, with two chats at once", async () => {
    const onboarding = (await host.createDocument({ path: path.join(dir, "Onboarding.sonobe"), template: "photo-zoom" })).docId;
    // The prototype a call without docId would land in: neither window shows it.
    const other = (await host.createDocument({ path: path.join(dir, "Scratch.sonobe"), template: "photo-zoom" })).docId;
    expect((await host.getDocument()).docId).toBe(other);
    const shows: Record<string, string> = { w1: docId, w2: onboarding };
    await restartAgent({}, (windowId) => shows[windowId]!);
    const design = (windowId: string) => agent.run(windowId, { text: "a checkout screen", context: CONTEXT }, (event) => events.push(event));
    const results = await Promise.all([design("w1"), design("w2")]);
    expect(results.map((r) => r.outcome), JSON.stringify(results)).toEqual(["completed", "completed"]);
    const checkouts = async (id: string) => (await host.getDocument(id)).doc.components.main!.layers.filter((l) => l.name === "Checkout").length;
    expect([await checkouts(docId), await checkouts(onboarding), await checkouts(other)]).toEqual([1, 1, 0]);
    // Each drew live in its own window's document too.
    expect(new Set(previews.filter((p) => p.status === "writing").map((p) => p.docId))).toEqual(new Set([docId, onboarding]));
    expect(ofType("tool_finished").flatMap((e) => (e.imported ? [e.imported.docId] : [])).sort()).toEqual([docId, onboarding].sort());
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

  it("still asks before a save when the person's own Claude Code mode wouldn't: the session is put in the mode that asks", async () => {
    await restartAgent({ FAKE_CLAUDE_MODE: "auto" });
    const result = await send("save it", {}, (e) => {
      if (e.type === "confirm_required") queueMicrotask(() => agent.confirm("w1", e.confirmationId, false));
    });
    expect(result.outcome).toBe("completed");
    expect(ofType("confirm_required")).toEqual([expect.objectContaining({ kind: "permission", title: "Allow Claude to save this prototype?" })]);
    const log = await fakeLog();
    expect(log.filter((l) => l.kind === "mode")).toEqual([expect.objectContaining({ from: "auto", to: "default", via: "config_option" })]);
    expect(log.filter((l) => l.kind === "unasked" || l.kind === "mcp_result")).toEqual([]);
    expect(reply()).toBe("Okay, I won't.");
  });

  it("runs nothing when Claude Code's mode can't be set to ask", async () => {
    await restartAgent({ FAKE_CLAUDE_MODE: "auto", FAKE_CLAUDE_MODE_LOCKED: "1" });
    expect(await send("save it")).toMatchObject({ outcome: "error", error: { code: "agent_failed", message: MODE_NOT_SET } });
    // The session it opened is closed (without waiting for the answer).
    for (let i = 0; i < 100 && !(await fakeLog()).some((l) => l.kind === "session/close"); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const log = await fakeLog();
    expect(log.some((l) => l.kind === "session/close")).toBe(true);
    expect(log.some((l) => l.kind === "session/prompt")).toBe(false);
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

  it("starts a new session when Claude Code dies under the adapter, which keeps running", async () => {
    expect((await send("echo hello")).outcome).toBe("completed");
    expect(await send("sessionend")).toMatchObject({ outcome: "error", error: { code: "agent_crashed", message: SESSION_ENDED } });
    events = [];
    expect((await send("echo again")).outcome).toBe("completed");
    expect(reply()).toBe("Echo: echo again");
    expect(ofType("notice").map((n) => n.message)).toEqual([RESTARTED]);
    const log = await fakeLog();
    expect(log.filter((l) => l.kind === "initialize")).toHaveLength(1);
    expect(log.filter((l) => l.kind === "session/new")).toHaveLength(2);
  });

  it("says what went wrong when the adapter fails a reply with a plain Error, which reaches Sonobe as its details", async () => {
    expect(await send("plainerror")).toMatchObject({ outcome: "error", error: { code: "unknown", message: "Claude's agent adapter couldn't finish the reply: Claude Code process exited with code 1. Send your message again." } });
    // The chat keeps its session.
    expect((await send("echo hello")).outcome).toBe("completed");
    expect((await fakeLog()).filter((l) => l.kind === "session/new")).toHaveLength(1);
  });

  it("tells the plan's usage limit from a transient rate limit", async () => {
    expect(await send("limit")).toMatchObject({ outcome: "error", error: { code: "usage_limit", message: "Your Claude plan's usage limit is reached (“You've hit your limit · resets 3pm”). Try again once it resets, or switch the Assistant to your API key." } });
    expect(await send("ratelimit")).toMatchObject({ outcome: "error", error: { code: "rate_limited", message: RATE_LIMITED } });
    // Neither costs the chat its session.
    expect((await send("echo hello")).outcome).toBe("completed");
    expect((await fakeLog()).filter((l) => l.kind === "session/new")).toHaveLength(1);
  });

  it("switches the chat's model to the adapter's own value for it", async () => {
    await send("echo hello");
    events = [];
    expect((await send("echo again", { model: "claude-opus-5" })).outcome).toBe("completed");
    expect(ofType("notice")).toEqual([]);
    expect((await fakeLog()).filter((l) => l.kind === "session/set_config_option")).toEqual([expect.objectContaining({ params: expect.objectContaining({ configId: "model", value: "opus[1m]" }) })]);
  });

  it("checks the login without restarting the adapter under a chat", async () => {
    await send("echo hello");
    expect(await agent.checkSubscription()).toMatchObject({ state: "ready", kind: "account", label: "Claude Max", email: "fake@example.com" });
    const log = await fakeLog();
    expect(log.filter((l) => l.kind === "initialize")).toHaveLength(1);
    expect(log.filter((l) => l.kind === "cli")).toEqual([expect.objectContaining({ args: ["auth", "status", "--json"] })]);
    events = [];
    expect((await send("echo again")).outcome).toBe("completed");
    expect(ofType("notice")).toEqual([]);
  });

  it("says Claude isn't signed in", async () => {
    expect(await send("signedout")).toMatchObject({ outcome: "error", error: { code: "not_signed_in", message: expect.stringContaining("Choose Sign in") } });
    expect(await agent.checkSubscription()).toMatchObject({ state: "ready", kind: "account", label: "Claude Max", email: "fake@example.com", adapterVersion: "0.0.0-fake" });
  });
});
