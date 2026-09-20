/**
 * The shared tool runner on its own (agent.test.ts drives it through the API agent loop): what's new
 * for the subscription path, where Claude draws with preview_design and imports the draft with
 * import_design { preview: true }, the hooks its MCP endpoint uses, and chats over a real headless host.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SonobeDocument } from "@sonobe/core";
import { createHeadlessHost, IMPORT_META_KEY, type CapturedDesign, type HeadlessHost, type ImportResultMeta } from "@sonobe/mcp";
import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLimits } from "./agent.ts";
import type { ReplaceCheck, ReplaceGuard } from "./designGuard.ts";
import type { AssistantCanvasContext, AssistantEvent } from "./protocol.ts";
import { FAKE_TOOLS, fakeBridge, text } from "./testing.ts";
import { createMcpToolBridge, type AssistantToolInfo, type ToolCallOptions, type ToolCallResult } from "./toolBridge.ts";
import { createToolRunner, REPLACE_GUARD, type PreviewDraft, type ReplaceGuardKit, type RunGuards, type ToolRunOptions } from "./toolRunner.ts";

const PREVIEW: AssistantToolInfo = {
  name: "preview_design",
  title: "Preview design",
  description: "Draw the screen on the canvas.",
  inputSchema: { type: "object", properties: { docId: { type: "string" }, component: { type: "string" }, name: { type: "string" }, replace: { type: ["string", "null"] }, html: { type: "string" }, append: { type: "string" }, clear: { type: "boolean" } } },
  readOnly: false,
};
/** A read and a write that take docId. */
const DOCUMENT_INFO: AssistantToolInfo = { name: "get_document_info", title: "Get document info", description: "About the document.", inputSchema: { type: "object", properties: { docId: { type: "string" } } }, readOnly: true };
const RENAME: AssistantToolInfo = { name: "rename", title: "Rename", description: "Rename layers.", inputSchema: { type: "object", properties: { docId: { type: "string" }, updates: { type: "array" } } }, readOnly: false };
const TOOLS = [...FAKE_TOOLS, PREVIEW, DOCUMENT_INFO, RENAME];
const DOC = { project: { root: "main" } } as unknown as SonobeDocument;
const CONTEXT: AssistantCanvasContext = { component: { id: "main", name: "Main", size: [402, 874] }, screens: [{ id: "home", name: "Home" }] };
const UNTARGETED: ReplaceCheck = { reason: "untargeted", target: { id: "home", name: "Home" }, changed: [], changedCount: 0 };

function imported(meta: Partial<ImportResultMeta> = {}): ToolCallResult {
  const full: ImportResultMeta = { docId: "photo_zoom", component: "main", dryRun: false, screenId: "checkout", screenName: "Checkout", txnId: "txn_1", replaced: null, dropped: [], droppedCount: 0, lostConnections: 0, kept: null, ...meta };
  return { content: [{ type: "text", text: `Imported “${full.screenName}”` }], meta: { [IMPORT_META_KEY]: full } };
}

/** preview_design's result, naming the draft's fields as the server merged them. */
const previewed = (fields: { component?: string | null; replace?: string | null } = {}): ToolCallResult => ({
  content: [{ type: "text", text: "Showing “Checkout” on the canvas (1 KB so far)." }],
  structuredContent: { docId: "photo_zoom", name: "Checkout", component: null, replace: null, ...fields, bytes: 1000 },
});

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
    declinedMessage: (check, declined) => `The person kept “${check.target.name}” as it is, so nothing changed.${declined?.preview ? " (a preview import)" : ""}`,
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
  it("puts a draft the box starts into the box's component, and leaves appends and preview imports to the draft's own", async () => {
    const h = harness((name, args) => (name === "preview_design" ? previewed() : args.dryRun ? imported({ dryRun: true, screenId: null }) : imported()));
    const run = h.runner({ ...CONTEXT, component: { id: "card_kit", name: "Card Kit", size: [370, 240] } });
    await run.run({ id: "p1", name: "preview_design", input: { name: "Checkout", html: "<main>" } });
    await run.run({ id: "p2", name: "preview_design", input: { append: "<p>" } });
    await run.run({ id: "p3", name: "preview_design", input: { component: "settings", append: "</main>" } });
    await run.run({ id: "p4", name: "preview_design", input: { clear: true } });
    await run.run({ id: "i1", name: "import_design", input: { preview: true } });
    await run.run({ id: "i2", name: "import_design", input: { html: "<main>" } });
    await h.runner().run({ id: "p5", name: "preview_design", input: { html: "<p>" } });
    expect(h.bridge.calls.map((c) => c.args)).toEqual([
      { name: "Checkout", html: "<main>", docId: "photo_zoom", component: "card_kit" },
      { append: "<p>", docId: "photo_zoom" },
      { component: "settings", append: "</main>", docId: "photo_zoom" },
      { clear: true, docId: "photo_zoom" },
      // This chat has no draft now, so the import asks the server what the draft replaces first.
      { preview: true, docId: "photo_zoom", dryRun: true, screenshot: false },
      { preview: true, docId: "photo_zoom" },
      { html: "<main>", docId: "photo_zoom", component: "card_kit" },
      { html: "<p>", docId: "photo_zoom" },
    ]);
    // The preview draws on the canvas and changes nothing in the document.
    expect(ofType(h.events, "tool_finished").slice(0, 4).map((e) => [e.status, e.changedDocument])).toEqual([
      ["done", false],
      ["done", false],
      ["done", false],
      ["done", false],
    ]);
  });

  it("checks an import of the draft with the replace and component the server's result names, dry-running the preview import once", async () => {
    // The box shows "main"; Claude started the draft in "kit".
    const h = harness((name, args) => (name === "preview_design" ? previewed({ component: "kit", replace: "home" }) : args.dryRun ? imported({ dryRun: true, screenId: null, component: "kit", replaced: "home", dropped: [{ id: "promo", name: "Promo" }], droppedCount: 1 }) : imported()), { check: UNTARGETED, approve: false });
    const run = h.runner(CONTEXT);
    await run.run({ id: "p1", name: "preview_design", input: { name: "Home", component: "kit", replace: "home", html: "<main>" } });
    await run.run({ id: "p2", name: "preview_design", input: { append: "</main>" } });
    const result = await run.run({ id: "i1", name: "import_design", input: { preview: true } });

    expect(h.seen.checks).toEqual([{ docId: "photo_zoom", component: "kit", replace: "home", picked: null }]);
    expect(h.bridge.calls.slice(1).map((c) => c.args)).toEqual([
      { append: "</main>", docId: "photo_zoom" },
      { preview: true, docId: "photo_zoom", dryRun: true, screenshot: false },
    ]);
    expect(ofType(h.events, "confirm_required")).toEqual([expect.objectContaining({ toolUseId: "i1", kind: "replace", title: "Replace “Home”?" })]);
    expect(ofType(h.events, "tool_finished").at(-1)).toMatchObject({ toolUseId: "i1", status: "declined", detail: "You kept “Home”" });
    // The declined text is the preview import's: leaving out replace would keep the draft's.
    const declined = "The person kept “Home” as it is, so nothing changed. (a preview import)";
    expect(result).toEqual({ content: [{ type: "text", text: declined }], plainText: declined });
  });

  it("asks the server with a dry run about a draft this chat didn't write, and reuses that dry run for the question", async () => {
    // An earlier chat left a redesign draft of “Home” in “kit”; this chat never called preview_design.
    const h = harness((_name, args) => (args.dryRun ? imported({ dryRun: true, screenId: null, component: "kit", replaced: "home" }) : imported({ screenId: "home", replaced: "home" })), { check: UNTARGETED, approve: true });
    const result = await h.runner(CONTEXT).run({ id: "i1", name: "import_design", input: { preview: true } });
    expect(result.isError).toBeFalsy();
    expect(h.seen.checks).toEqual([{ docId: "photo_zoom", component: "kit", replace: "home", picked: null }]);
    expect(h.bridge.calls.map((c) => c.args)).toEqual([
      { preview: true, docId: "photo_zoom", dryRun: true, screenshot: false },
      { preview: true, docId: "photo_zoom" },
    ]);
    expect(ofType(h.events, "confirm_required")).toHaveLength(1);
    expect(h.seen.remembered).toEqual([["photo_zoom", "kit", "home", DOC, DOC]]);
  });

  it("imports when the person approves, remembers the screen in the draft's component, and forgets the draft", async () => {
    const h = harness((name, args) => (name === "preview_design" ? previewed({ component: "kit", replace: "home" }) : args.dryRun ? imported({ dryRun: true, screenId: null }) : imported({ screenId: "home", replaced: "home" })), { check: UNTARGETED, approve: true });
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
    // The draft is layers now: a later preview import asks the server, which names no replace.
    await run.run({ id: "i2", name: "import_design", input: { preview: true } });
    expect(h.seen.checks).toHaveLength(1);
  });

  it("keeps the draft as the server's results say: a failed call leaves it, no_draft forgets it, clear drops it", async () => {
    const noDraft: ToolCallResult = { content: [{ type: "text", text: "Error no_draft: There's no draft to add to." }], structuredContent: { ok: false, changed: "none", error: { code: "no_draft", message: "There's no draft to add to." } }, isError: true };
    const gone: ToolCallResult = { content: [{ type: "text", text: "Error not_found" }], structuredContent: { ok: false, changed: "none", error: { code: "not_found", message: "No layer card." } }, isError: true };
    let next: ToolCallResult = previewed({ replace: "home" });
    const h = harness(() => next);
    const run = h.runner();
    // A new chat's html without replace: the server kept an earlier chat's replace, and so does this chat.
    await run.run({ id: "p1", name: "preview_design", input: { html: "<main>" } });
    expect(h.previews.get("photo_zoom")).toEqual({ component: null, replace: "home" });
    next = gone;
    await run.run({ id: "p2", name: "preview_design", input: { replace: "card", append: "<p>" } });
    expect(h.previews.get("photo_zoom")).toEqual({ component: null, replace: "home" });
    next = noDraft;
    await run.run({ id: "p3", name: "preview_design", input: { append: "<p>" } });
    expect(h.previews.has("photo_zoom")).toBe(false);
    next = previewed({ component: "kit", replace: null });
    await run.run({ id: "p4", name: "preview_design", input: { replace: null, html: "<main>" } });
    expect(h.previews.get("photo_zoom")).toEqual({ component: "kit", replace: null });
    await run.run({ id: "p5", name: "preview_design", input: { clear: true } });
    expect(h.previews.has("photo_zoom")).toBe(false);
  });

  it("records a preview whose answer came back after Stop", async () => {
    const h = harness(() => {
      h.controller.abort();
      return previewed({ replace: "home" });
    });
    expect(await h.runner().run({ id: "p1", name: "preview_design", input: { replace: "home", html: "<main>" } })).toMatchObject({ isError: true });
    expect(h.previews.get("photo_zoom")).toEqual({ component: null, replace: "home" });
  });

  it("forgets the draft when Stop cut a preview off, since the server may have taken it anyway", async () => {
    // The real bridge's MCP client gives up as soon as Stop aborts; the server's handler runs on.
    let stop = false;
    const h = harness(async (_name, _args, options) => {
      if (!stop) return previewed({ replace: null });
      h.controller.abort();
      throw options.signal?.reason ?? new Error("aborted");
    });
    await h.runner().run({ id: "p1", name: "preview_design", input: { name: "Settings", html: "<main>" } });
    expect(h.previews.get("photo_zoom")).toEqual({ component: null, replace: null });
    stop = true;
    const cut = await h.runner().run({ id: "p2", name: "preview_design", input: { replace: "home", html: "<main>" } });
    expect(cut).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringMatching(/^The person pressed Stop while preview_design was running/) }] });
    expect(h.previews.has("photo_zoom")).toBe(false);
  });

  it("doesn't ask about a draft the server no longer has, and forgets it", async () => {
    const noDraft: ToolCallResult = { content: [{ type: "text", text: "Error no_draft" }], structuredContent: { ok: false, changed: "none", error: { code: "no_draft", message: "There's no design preview to import." } }, isError: true };
    const h = harness((name) => (name === "preview_design" ? previewed({ replace: "home" }) : noDraft), { check: UNTARGETED, approve: true });
    const run = h.runner();
    await run.run({ id: "p1", name: "preview_design", input: { replace: "home", html: "<main>" } });
    // Fifteen idle minutes later the server dropped it: the dry run says so before anyone is asked.
    expect(await run.run({ id: "i1", name: "import_design", input: { preview: true } })).toMatchObject({ isError: true, content: [{ type: "text", text: "Error no_draft" }] });
    expect(ofType(h.events, "confirm_required")).toEqual([]);
    expect(h.previews.has("photo_zoom")).toBe(false);
  });

  it("lets the import's own replace win over the draft's, null included", async () => {
    const h = harness((name) => (name === "preview_design" ? previewed({ replace: "home" }) : imported()), { check: null });
    const run = h.runner();
    await run.run({ id: "p1", name: "preview_design", input: { replace: "home", html: "<main>" } });
    await run.run({ id: "i1", name: "import_design", input: { preview: true, replace: null } });
    expect(h.seen.checks).toEqual([]);
    await run.run({ id: "i2", name: "import_design", input: { preview: true, replace: "card" } });
    expect(h.seen.checks).toEqual([{ docId: "photo_zoom", component: "main", replace: "card", picked: null }]);
  });
});

describe("tool runner: another window's document", () => {
  it("reads another window's prototype, but refuses to change it", async () => {
    const h = harness(() => text("ok"));
    const run = h.runner();
    await run.run({ id: "r1", name: "get_document_info", input: { docId: "onboarding" } });
    const refused = await run.run({ id: "d1", name: "rename", input: { docId: "onboarding", updates: [{ id: "card", name: "Card" }] } });
    const drawn = await run.run({ id: "p1", name: "preview_design", input: { docId: "onboarding", html: "<main>" } });
    // Naming the window's own document is fine.
    await run.run({ id: "i1", name: "import_design", input: { docId: "photo_zoom", html: "<main>" } });
    expect(h.bridge.calls).toEqual([
      { name: "get_document_info", args: { docId: "onboarding" } },
      { name: "import_design", args: { docId: "photo_zoom", html: "<main>" } },
    ]);
    const message = (tool: string) => `This chat edits the prototype in its own window, so ${tool} didn't run on “onboarding”. Leave out docId to change this window's prototype, or ask the person to open the chat in the other window.`;
    expect(refused).toEqual({ content: [{ type: "text", text: message("rename") }], isError: true, plainText: message("rename") });
    expect(drawn).toMatchObject({ isError: true, plainText: message("preview_design") });
    expect(ofType(h.events, "tool_finished").map((e) => [e.toolUseId, e.status])).toEqual([
      ["r1", "done"],
      ["d1", "error"],
      ["p1", "error"],
      ["i1", "done"],
    ]);
    expect(ofType(h.events, "confirm_required")).toEqual([]);
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

/** A capture window that reads every page as one small screen (no browser in tests). */
const CAPTURE = {
  format: "sonobe.design-capture",
  version: 1,
  source: { kind: "html", title: "Settings" },
  viewport: { width: 402, height: 874 },
  root: { kind: "frame", name: "Settings", box: [0, 0, 402, 874], fill: "#F5F5F7FF", children: [{ kind: "text", name: "Title", text: "Settings", box: [20, 80, 200, 40], style: { fontFamily: "system-ui", fontSize: 34, fontWeight: 700, color: "#111118FF", lineHeight: 40 } }] },
  images: {},
};

describe("tool runner: chats over a real headless host", () => {
  let dir: string;
  let host: HeadlessHost;

  afterEach(async () => {
    await host.close();
    await rm(dir, { recursive: true, force: true });
  });

  /**
   * The subscription path's bridge (preview_design shown) and a chat maker: each chat has its own
   * drafts and replace guard unless given some, and declines every question. `onRead`: called as a
   * tool's handler reads the document, before it changes anything. `onPreview`: given, the host has a
   * canvas, and it's called as the canvas takes each preview_design update, after the server kept it.
   */
  async function setup(hooks: { onRead?(): void; onPreview?(): void } = {}) {
    dir = await mkdtemp(path.join(tmpdir(), "sonobe-runner-"));
    host = createHeadlessHost({ registry: createPatchRegistry() });
    await host.createDocument({ path: path.join(dir, "Runner Test.sonobe"), template: "photo-zoom" });
    const capturing = Object.create(host) as HeadlessHost;
    Object.defineProperty(capturing, "captureDesign", { value: async (): Promise<CapturedDesign> => ({ capture: CAPTURE as never, images: new Map() }) });
    if (hooks.onPreview) {
      const onPreview = hooks.onPreview;
      Object.defineProperty(capturing, "capabilities", { value: { ...host.capabilities, designPreview: true } });
      Object.defineProperty(capturing, "showDesignPreview", { value: async () => onPreview() });
    }
    Object.defineProperty(capturing, "getDocument", {
      value: (...args: Parameters<HeadlessHost["getDocument"]>) => {
        hooks.onRead?.();
        return host.getDocument(...args);
      },
    });
    const bridge = createMcpToolBridge({ host: capturing, version: "0.1.0-test", hidden: new Map() });
    const tools = new Map((await bridge.tools()).map((t) => [t.name, t]));
    const { docId, doc } = await host.getDocument();
    const screen = doc.components[doc.project.root]!.layers[0]!;
    let chats = 0;
    const chat = (reply: { previews?: Map<string, PreviewDraft>; signal?: AbortSignal } = {}) => {
      const n = ++chats;
      const events: AssistantEvent[] = [];
      const active: RunGuards = { removedWithoutAsking: 0, confirmations: new Map() };
      let guard: ReplaceGuard | null = null;
      let ids = 0;
      const runner = createToolRunner({
        conversationId: "w1",
        runId: `r${n}`,
        request: { text: "design a settings screen" },
        emit: (event) => {
          events.push(event);
          if (event.type === "confirm_required") queueMicrotask(() => active.confirmations.get(event.confirmationId)?.(false));
        },
        signal: reply.signal ?? new AbortController().signal,
        bridge,
        tools,
        limits: resolveLimits(),
        log: () => undefined,
        newId: () => `c${n}-${++ids}`,
        documentFor: async () => ({ docId, projectPath: null }),
        readDocument: async (id) => (await host.getDocument(id)).doc,
        guard: () => (guard ??= REPLACE_GUARD.create()),
        guardIfAny: () => guard,
        replaceGuard: REPLACE_GUARD,
        active,
        previews: reply.previews ?? new Map(),
        announce: true,
        readOnlyNoticeSent: { value: false },
      });
      return { runner, events };
    };
    const screens = async () => (await host.getDocument()).doc.components[doc.project.root]!.layers.map((l) => l.name);
    return { bridge, chat, screen, screens };
  }

  it("asks before a new chat's preview import replaces a screen, when an earlier chat's draft still carries the replace", async () => {
    const { bridge, chat, screen, screens } = await setup();
    try {
      const before = await screens();
      const a = chat();
      await a.runner.run({ id: "a1", name: "preview_design", input: { name: "Redesign", replace: screen.id, html: "<main>Redesign</main>" } });
      // New chat: the draft is the Assistant's on the server, and its replace stays unless a call clears it.
      const b = chat();
      const kept = await b.runner.run({ id: "b1", name: "preview_design", input: { name: "Settings", html: "<main>Settings</main>" } });
      expect(kept.content[0]).toMatchObject({ text: expect.stringContaining(`which replaces “${screen.name}”`) });
      const declined = await b.runner.run({ id: "b2", name: "import_design", input: { preview: true } });
      expect(ofType(b.events, "confirm_required")).toEqual([expect.objectContaining({ title: `Replace “${screen.name}”?` })]);
      expect(declined.plainText).toBe(`The person kept “${screen.name}” as it is, so nothing changed. Import your design as a new screen instead (import_design with "preview": true and "replace": null), or ask what they'd like.`);
      expect(await screens()).toEqual(before);

      // A third chat never drew the draft: its import asks the server what it replaces, and asks too.
      const c = chat();
      await c.runner.run({ id: "c1", name: "import_design", input: { preview: true } });
      expect(ofType(c.events, "confirm_required")).toHaveLength(1);
      expect(await screens()).toEqual(before);
      // Doing what the declined text says imports a new screen, without asking again.
      const added = await c.runner.run({ id: "c2", name: "import_design", input: { preview: true, replace: null } });
      expect(added.isError, JSON.stringify(added.content)).toBeFalsy();
      expect(ofType(c.events, "confirm_required")).toHaveLength(1);
      expect(await screens()).toEqual([...before, "Settings"]);
    } finally {
      await bridge.close();
    }
  });

  it("asks before a preview import after Stop cut off a preview_design the server still took", async () => {
    let onPreview: (() => void) | null = null;
    const { bridge, chat, screen, screens } = await setup({ onPreview: () => onPreview?.() });
    try {
      const before = await screens();
      // One chat over three replies: its drafts carry over, and each reply has its own Stop.
      const previews = new Map<string, PreviewDraft>();
      await chat({ previews }).runner.run({ id: "a1", name: "preview_design", input: { name: "Settings", html: "<main>Settings</main>" } });
      expect([...previews.values()]).toEqual([{ component: null, replace: null }]);
      // Stop while the canvas takes the redesign's preview_design: the server has kept the draft, the MCP client gives up
      // at once, and the server's handler goes on.
      const stop = new AbortController();
      onPreview = () => {
        onPreview = null;
        stop.abort();
      };
      const cut = await chat({ previews, signal: stop.signal }).runner.run({ id: "b1", name: "preview_design", input: { replace: screen.id, html: "<main>Settings</main>" } });
      expect(cut).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringMatching(/^The person pressed Stop while preview_design was running/) }] });
      await new Promise((resolve) => setTimeout(resolve, 50));
      // "Ok, add it": the draft replaces a screen the Assistant never made, so it asks.
      const next = chat({ previews });
      await next.runner.run({ id: "c1", name: "import_design", input: { preview: true } });
      expect(ofType(next.events, "confirm_required")).toEqual([expect.objectContaining({ title: `Replace “${screen.name}”?` })]);
      expect(await screens()).toEqual(before);
    } finally {
      await bridge.close();
    }
  });

  it("leaves the draft as it was when Stop reaches a preview_design before the server takes it", async () => {
    let onRead: (() => void) | null = null;
    const { bridge, chat, screen, screens } = await setup({ onRead: () => onRead?.() });
    try {
      const before = await screens();
      const previews = new Map<string, PreviewDraft>();
      await chat({ previews }).runner.run({ id: "a1", name: "preview_design", input: { name: "Settings", html: "<main>Settings</main>" } });
      // Stop while the redesign's preview_design reads the document: the server sees the cancel before it takes the call.
      const stop = new AbortController();
      onRead = () => {
        onRead = null;
        stop.abort();
      };
      const cut = await chat({ previews, signal: stop.signal }).runner.run({ id: "b1", name: "preview_design", input: { replace: screen.id, html: "<main>Redesign</main>" } });
      expect(cut).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringMatching(/^The person pressed Stop while preview_design was running/) }] });
      await new Promise((resolve) => setTimeout(resolve, 50));
      // The draft is still the new screen: importing it adds one, without asking.
      const next = chat({ previews });
      const added = await next.runner.run({ id: "c1", name: "import_design", input: { preview: true } });
      expect(added.isError, JSON.stringify(added.content)).toBeFalsy();
      expect(ofType(next.events, "confirm_required")).toEqual([]);
      expect(await screens()).toEqual([...before, "Settings"]);
    } finally {
      await bridge.close();
    }
  });
});
