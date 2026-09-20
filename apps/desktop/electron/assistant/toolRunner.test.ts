/**
 * The shared tool runner on its own (agent.test.ts drives it through the API agent loop): what's new
 * for the subscription path, where Claude draws with preview_design and imports the draft with
 * import_design { preview: true }, and the hooks its MCP endpoint uses.
 */

import type { SonobeDocument } from "@sonobe/core";
import { IMPORT_META_KEY, type ImportResultMeta } from "@sonobe/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLimits } from "./agent.ts";
import type { ReplaceCheck, ReplaceGuard } from "./designGuard.ts";
import type { AssistantCanvasContext, AssistantEvent } from "./protocol.ts";
import { FAKE_TOOLS, fakeBridge, text } from "./testing.ts";
import type { AssistantToolInfo, ToolCallOptions, ToolCallResult } from "./toolBridge.ts";
import { createToolRunner, type PreviewDraft, type ReplaceGuardKit, type RunGuards, type ToolRunOptions } from "./toolRunner.ts";

const PREVIEW: AssistantToolInfo = {
  name: "preview_design",
  title: "Preview design",
  description: "Draw the screen on the canvas.",
  inputSchema: { type: "object", properties: { docId: { type: "string" }, component: { type: "string" }, name: { type: "string" }, replace: { type: ["string", "null"] }, html: { type: "string" }, append: { type: "string" }, clear: { type: "boolean" } } },
  readOnly: false,
};
const TOOLS = [...FAKE_TOOLS, PREVIEW];
const DOC = { project: { root: "main" } } as unknown as SonobeDocument;
const CONTEXT: AssistantCanvasContext = { component: { id: "main", name: "Main", size: [402, 874] }, screens: [{ id: "home", name: "Home" }] };
const UNTARGETED: ReplaceCheck = { reason: "untargeted", target: { id: "home", name: "Home" }, changed: [], changedCount: 0 };

function imported(meta: Partial<ImportResultMeta> = {}): ToolCallResult {
  const full: ImportResultMeta = { docId: "photo_zoom", dryRun: false, screenId: "checkout", screenName: "Checkout", txnId: "txn_1", replaced: null, dropped: [], droppedCount: 0, lostConnections: 0, kept: null, ...meta };
  return { content: [{ type: "text", text: `Imported “${full.screenName}”` }], meta: { [IMPORT_META_KEY]: full } };
}

const previewed = (docId = "photo_zoom"): ToolCallResult => ({ content: [{ type: "text", text: "Showing “Checkout” on the canvas (1 KB so far)." }], structuredContent: { docId, name: "Checkout", bytes: 1000 } });

/** The runner over a fake bridge, with a replace guard that answers `check` (null: nothing to ask) and records what it's told. */
function harness(handler: (name: string, args: Record<string, unknown>, options: ToolCallOptions) => ToolCallResult | Promise<ToolCallResult>, options: { check?: ReplaceCheck | null; approve?: boolean | null; announce?: boolean } = {}) {
  const bridge = fakeBridge((name, args, _index, callOptions) => handler(name, args, callOptions));
  const events: AssistantEvent[] = [];
  const seen = { checks: [] as unknown[], remembered: [] as unknown[][] };
  const guard: ReplaceGuard = {
    check: (request) => {
      seen.checks.push(request);
      return options.check ?? null;
    },
    remember: (...args) => void seen.remembered.push(args),
    refresh: () => undefined,
    tracks: () => seen.remembered.length > 0,
    clear: () => undefined,
  };
  const kit: ReplaceGuardKit = {
    create: () => guard,
    prompt: (check) => ({ count: 0, kind: "replace", title: `Replace “${check.target.name}”?`, message: "Claude wants to rebuild it." }),
    declinedMessage: (check) => `The person kept “${check.target.name}” as it is, so nothing changed.`,
    declinedDetail: (check) => `You kept “${check.target.name}”`,
  };
  const active: RunGuards = { removedWithoutAsking: 0, confirmations: new Map() };
  const previews = new Map<string, PreviewDraft>();
  const controller = new AbortController();
  let ids = 0;
  let made: ReplaceGuard | null = null;
  const emit = (event: AssistantEvent) => {
    events.push(event);
    if (event.type === "confirm_required" && options.approve !== null) queueMicrotask(() => active.confirmations.get(event.confirmationId)?.(options.approve ?? false));
  };
  const runner = (context?: AssistantCanvasContext) =>
    createToolRunner({
      conversationId: "w1",
      runId: "r1",
      request: { text: "a checkout", ...(context ? { context } : {}) },
      emit,
      signal: controller.signal,
      bridge,
      tools: new Map(TOOLS.map((t) => [t.name, t])),
      limits: resolveLimits(),
      log: () => undefined,
      newId: () => `c${++ids}`,
      documentFor: async () => ({ docId: "photo_zoom", projectPath: null }),
      readDocument: async () => DOC,
      guard: () => (made ??= kit.create()),
      guardIfAny: () => made,
      replaceGuard: kit,
      active,
      previews,
      announce: options.announce ?? true,
      readOnlyNoticeSent: { value: false },
    });
  return { bridge, events, seen, previews, active, controller, runner };
}

const ofType = <T extends AssistantEvent["type"]>(events: AssistantEvent[], type: T) => events.filter((e): e is Extract<AssistantEvent, { type: T }> => e.type === type);

afterEach(() => {
  vi.useRealTimers();
});

describe("tool runner: preview_design", () => {
  it("pins a box message's preview to the window's document and the box's component, unless Claude named one", async () => {
    const h = harness((name) => (name === "preview_design" ? previewed() : text("ok")));
    const run = h.runner({ ...CONTEXT, component: { id: "card_kit", name: "Card Kit", size: [370, 240] } });
    await run.run({ id: "p1", name: "preview_design", input: { name: "Checkout", html: "<main>" } });
    await run.run({ id: "p2", name: "preview_design", input: { component: "settings", append: "</main>" } });
    await h.runner().run({ id: "p3", name: "preview_design", input: { append: "<p>" } });
    expect(h.bridge.calls.map((c) => c.args)).toEqual([
      { name: "Checkout", html: "<main>", docId: "photo_zoom", component: "card_kit" },
      { component: "settings", append: "</main>", docId: "photo_zoom" },
      { append: "<p>", docId: "photo_zoom" },
    ]);
    // The preview draws on the canvas and changes nothing in the document.
    expect(ofType(h.events, "tool_finished").map((e) => [e.status, e.changedDocument])).toEqual([
      ["done", false],
      ["done", false],
      ["done", false],
    ]);
  });

  it("checks an import of the draft with the draft's replace, dry-running the preview import", async () => {
    const h = harness((name, args) => (name === "preview_design" ? previewed() : args.dryRun ? imported({ dryRun: true, screenId: null, replaced: "home", dropped: [{ id: "promo", name: "Promo" }], droppedCount: 1 }) : imported()), { check: UNTARGETED, approve: false });
    const run = h.runner(CONTEXT);
    await run.run({ id: "p1", name: "preview_design", input: { name: "Home", replace: "home", html: "<main>" } });
    await run.run({ id: "p2", name: "preview_design", input: { append: "</main>" } });
    const result = await run.run({ id: "i1", name: "import_design", input: { preview: true } });

    expect(h.seen.checks).toEqual([{ docId: "photo_zoom", component: "main", replace: "home", picked: null }]);
    expect(h.bridge.calls.at(-1)).toEqual({ name: "import_design", args: { preview: true, docId: "photo_zoom", component: "main", dryRun: true, screenshot: false } });
    expect(ofType(h.events, "confirm_required")).toEqual([expect.objectContaining({ toolUseId: "i1", kind: "replace", title: "Replace “Home”?" })]);
    expect(ofType(h.events, "tool_finished").at(-1)).toMatchObject({ toolUseId: "i1", status: "declined", detail: "You kept “Home”" });
    expect(result).toEqual({ content: [{ type: "text", text: "The person kept “Home” as it is, so nothing changed." }], plainText: "The person kept “Home” as it is, so nothing changed." });
  });

  it("imports when the person approves, remembers the screen in the draft's component, and forgets the draft", async () => {
    const h = harness((name, args) => (name === "preview_design" ? previewed() : args.dryRun ? imported({ dryRun: true, screenId: null }) : imported({ screenId: "home", replaced: "home" })), { check: UNTARGETED, approve: true });
    const run = h.runner();
    await run.run({ id: "p1", name: "preview_design", input: { component: "kit", replace: "home", html: "<main>" } });
    await run.run({ id: "i1", name: "import_design", input: { preview: true } });
    expect(h.bridge.calls.map((c) => [c.name, c.args.dryRun])).toEqual([
      ["preview_design", undefined],
      ["import_design", true],
      ["import_design", undefined],
    ]);
    expect(h.seen.remembered).toEqual([["photo_zoom", "kit", "home", DOC, DOC]]);
    expect(h.previews.size).toBe(0);
    // The draft is layers now: a later preview import has no replace of its own to check.
    await run.run({ id: "i2", name: "import_design", input: { preview: true } });
    expect(h.seen.checks).toHaveLength(1);
  });

  it("follows the draft's fields like the server does: a field passed wins, replace null clears it, clear drops the draft", async () => {
    const h = harness((name, args) => (name === "preview_design" ? (args.html === "<bad>" ? { content: [{ type: "text", text: "Error not_found" }], isError: true } : previewed()) : imported()), { check: UNTARGETED, approve: true });
    const run = h.runner();
    await run.run({ id: "p1", name: "preview_design", input: { replace: "home", html: "<main>" } });
    await run.run({ id: "p2", name: "preview_design", input: { html: "<main>again" } });
    expect(h.previews.get("photo_zoom")).toEqual({ component: null, replace: "home" });
    // A failed call leaves the server's draft as it was.
    await run.run({ id: "p3", name: "preview_design", input: { replace: "card", html: "<bad>" } });
    expect(h.previews.get("photo_zoom")).toEqual({ component: null, replace: "home" });
    await run.run({ id: "p4", name: "preview_design", input: { replace: null, append: "<p>" } });
    expect(h.previews.get("photo_zoom")).toEqual({ component: null, replace: null });
    await run.run({ id: "i1", name: "import_design", input: { preview: true } });
    expect(h.seen.checks).toEqual([]);

    await run.run({ id: "p5", name: "preview_design", input: { replace: "home", html: "<main>" } });
    await run.run({ id: "p6", name: "preview_design", input: { clear: true } });
    expect(h.previews.has("photo_zoom")).toBe(false);
  });

  it("lets the import's own replace win over the draft's, null included, and keeps drafts per document", async () => {
    const h = harness((name) => (name === "preview_design" ? previewed("other_doc") : imported()), { check: null });
    const run = h.runner();
    await run.run({ id: "p1", name: "preview_design", input: { docId: "other_doc", replace: "home", html: "<main>" } });
    expect([...h.previews.keys()]).toEqual(["other_doc"]);
    // This window's document has no draft of Claude's.
    await run.run({ id: "i1", name: "import_design", input: { preview: true } });
    await run.run({ id: "i2", name: "import_design", input: { docId: "other_doc", preview: true, replace: null } });
    expect(h.seen.checks).toEqual([]);
    await run.run({ id: "i3", name: "import_design", input: { docId: "other_doc", preview: true, replace: "card" } });
    expect(h.seen.checks).toEqual([{ docId: "other_doc", component: "main", replace: "card", picked: null }]);
  });
});

describe("tool runner: hooks for the subscription endpoint", () => {
  it("announces a call only when asked, and passes its progress to the caller too", async () => {
    const h = harness((_name, _args, options) => {
      options.onProgress?.("Rendering the HTML");
      return text("Outline");
    }, { announce: false });
    const progress: string[] = [];
    await h.runner().run({ id: "t1", name: "get_outline", input: {} }, { onProgress: (message) => progress.push(message) });
    await h.runner().run({ id: "t2", name: "get_outline", input: {} }, { announce: true });
    expect(ofType(h.events, "tool_started").map((e) => e.toolUseId)).toEqual(["t2"]);
    expect(ofType(h.events, "tool_progress")).toEqual([
      { type: "tool_progress", runId: "r1", toolUseId: "t1", detail: "Rendering the HTML" },
      { type: "tool_progress", runId: "r1", toolUseId: "t2", detail: "Rendering the HTML" },
    ]);
    expect(progress).toEqual(["Rendering the HTML"]);
  });

  it("sends a heartbeat while a call waits on the person, and stops when they answer", async () => {
    vi.useFakeTimers();
    const confirmation = { content: [{ type: "text", text: "Confirmation required" }], structuredContent: { status: "confirmation_required", confirmToken: "tok", summary: "Deleting 14 items from main: Card and 13 more." } };
    const h = harness((_name, args) => (args.confirmToken ? text("Deleted 14 items") : confirmation), { approve: null });
    const progress: string[] = [];
    const hooks: ToolRunOptions = { onProgress: (message) => progress.push(message), heartbeatMs: 1000 };
    const running = h.runner().run({ id: "d1", name: "delete_items", input: { ids: ["card"] } }, hooks);
    await vi.advanceTimersByTimeAsync(0);
    expect(ofType(h.events, "confirm_required")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2500);
    expect(progress).toEqual(["Waiting for your answer in Sonobe", "Waiting for your answer in Sonobe", "Waiting for your answer in Sonobe"]);
    h.active.confirmations.get(ofType(h.events, "confirm_required")[0]!.confirmationId)!(true);
    expect(await running).toMatchObject({ content: [{ type: "text", text: "Deleted 14 items" }] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(progress).toHaveLength(3);
  });

  it("marks a result that came back after Stop as an error, and answers with Sonobe's own text when nothing ran", async () => {
    const h = harness(() => {
      h.controller.abort();
      return text("Added 1 layer");
    });
    expect(await h.runner().run({ id: "a1", name: "add_layers", input: { layers: [] } })).toEqual({ content: [{ type: "text", text: "Added 1 layer" }], isError: true });
    expect(ofType(h.events, "tool_finished").at(-1)).toMatchObject({ toolUseId: "a1", status: "error", detail: "Stopped" });
    expect(await h.runner().run({ id: "x", name: "format_disk", input: {} })).toEqual({ content: [{ type: "text", text: "There's no tool named format_disk." }], isError: true, plainText: "There's no tool named format_disk." });
  });
});
