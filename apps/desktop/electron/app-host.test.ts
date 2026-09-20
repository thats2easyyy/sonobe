/**
 * The app host against the real editor: an EditorSession with the renderer RPC handlers from
 * apps/editor/src/host/rpcHandlers.ts, bridged through this app's rpc client/server with structured
 * cloning like IPC, and the MCP endpoint served over HTTP to the SDK client.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { findLayer, getDiagnostics, type Op } from "@sonobe/core";
import type { SceneFrame, SceneNode } from "@sonobe/engine";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createHttpHandler, createSimulationManager, createSonobeMcpServer, HostError, isHostError, TOOL_NAMES, type DesignPreviewUpdate, type NodeMcpHandler } from "@sonobe/mcp";
import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

// Count full diagnostics passes in this process (behavior unchanged).
vi.mock("@sonobe/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sonobe/core")>();
  return { ...actual, getDiagnostics: vi.fn(actual.getDiagnostics) };
});
import { createBrowserHost, createMemoryProjectStorage, type ProjectStorage } from "../../editor/src/host/browserHost.ts";
import { registerRpcHandlers } from "../../editor/src/host/rpcHandlers.ts";
import type { DesignPreviewUpdate as EditorDesignPreviewUpdate } from "../../editor/src/host/types.ts";
import { activeDraft, designStore, initialDesignData } from "../../editor/src/panels/design/designStore.ts";
import { createManualScheduler } from "../../editor/src/runtime/scheduler.ts";
import { createDemoDocument } from "../../editor/src/state/demoDocument.ts";
import { createEditorSession, type EditorSession } from "../../editor/src/state/session.ts";
import { writeResult } from "../../../packages/mcp/src/tools/write.ts";
import { estimateGraphGeometry, resolveGraphGeometry } from "../../../packages/mcp/src/geometry.ts";
import { createAppHost, hostErrorFromRpc, sceneLayerBounds, type AppHost, type AppHostOptions, type DocumentChange, type RendererTarget, type SceneRenderRequest } from "./app-host.ts";
import { createAssistantAgent } from "./assistant/agent.ts";
import { scriptedClient } from "./assistant/testing.ts";
import { createMcpToolBridge } from "./assistant/toolBridge.ts";
import { startMcpServer, type McpServerHandle } from "./mcp-server.ts";
import { createRpcClient, createRpcFailure, createRpcServer, type RpcServer } from "./rpc.ts";

const registry = createPatchRegistry();
const CLAUDE = { kind: "agent" as const, name: "Claude" };

/** A checkout screen as the capture window reads it (import_design's preview source renders the draft into it). */
const CHECKOUT_CAPTURE = {
  format: "sonobe.design-capture",
  version: 1,
  source: { kind: "html", title: "Checkout" },
  viewport: { width: 402, height: 874 },
  root: { kind: "frame", name: "Page", box: [0, 0, 402, 874], fill: "#FFFFFFFF", children: [{ kind: "frame", name: "Pay Button", nameRank: 5, box: [16, 780, 370, 52], fill: "#111118FF", radii: [14, 14, 14, 14], children: [] }] },
  images: {},
};

interface TestWindow {
  session: EditorSession;
  server: RpcServer;
  target: RendererTarget;
  focused: number;
  captures: { rect: unknown; size: { width: number; height: number } }[];
  captureResult: "ok" | "empty";
  /** The browser host's Save panel: the name it answers, and how often it was asked. */
  names: { save: string | null; asked: number };
  dispose(): void;
}

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** An editor window: a real session whose RPC handlers answer through a cloning bridge. */
function editorWindow(id: number, options: { handlers?: boolean; storage?: ProjectStorage; drafts?: ProjectStorage } = {}): TestWindow {
  const names = { save: "Agent Proto" as string | null, asked: 0 };
  const host = createBrowserHost({
    storage: options.storage ?? createMemoryProjectStorage(),
    ...(options.drafts ? { drafts: options.drafts, locks: null } : {}),
    channelName: null,
    recentKey: null,
    fileSystemAccess: false,
    dialogs: {
      promptName: async () => {
        names.asked++;
        return names.save;
      },
      pickProject: async () => null,
    },
  });
  const session = createEditorSession({ host, registry, document: createDemoDocument(registry), autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate", drafts: { debounceMs: 0, maxWaitMs: 0 } });
  let client: ReturnType<typeof createRpcClient>;
  const server = createRpcServer({ send: (response) => queueMicrotask(() => client.handleResponse(structuredClone(response))) });
  client = createRpcClient({ send: (request) => queueMicrotask(() => void server.dispatch(structuredClone(request))), defaultTimeoutMs: 5000 });
  const off = options.handlers === false ? () => undefined : registerRpcHandlers(session, { rpc: { handle: (method, fn) => server.handle(method, fn), methods: () => server.methods(), fail: createRpcFailure } });
  const w: TestWindow = {
    session,
    server,
    focused: 0,
    captures: [],
    captureResult: "ok",
    names,
    target: {
      id,
      invoke: <T>(method: string, params?: unknown, opts?: { timeoutMs?: number }) => client.invoke<T>(method, params, opts),
      hasMethod: (method) => server.methods().includes(method),
      focus: () => {
        w.focused++;
      },
      capture: async (rect, size) => {
        w.captures.push({ rect, size });
        return w.captureResult === "ok" ? { data: "iVBORw0KGgo=", width: size.width, height: size.height } : null;
      },
    },
    dispose() {
      off();
      session.dispose();
    },
  };
  cleanups.push(() => w.dispose());
  return w;
}

function appHost(windows: TestWindow[], extra: Partial<AppHostOptions> = {}): AppHost & { written: string[] } {
  const written: string[] = [];
  const host = createAppHost({
    registry,
    targets: () => windows.map((w) => w.target),
    approveProject: async (dir) => (dir.endsWith(".sonobe") ? dir : null),
    defaultProjectDir: async (name) => `/Users/test/Documents/${name}.sonobe`,
    projectExists: async () => false,
    writeProject: async (dir) => {
      written.push(dir);
    },
    ...extra,
  });
  cleanups.push(() => host.dispose());
  return Object.assign(host, { written });
}

async function rejection(promise: Promise<unknown>): Promise<{ code: string; message: string; hint?: string }> {
  try {
    await promise;
  } catch (err) {
    if (isHostError(err)) return { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) };
    throw err;
  }
  throw new Error("Expected a HostError");
}

/** Interaction → Switch → Pop Animation → Transition on the Next Card's scale. */
const pressChain: Op[] = [
  { op: "addPatch", patch: { id: "press_next", type: "interaction", name: "Press Next Card", inputs: { layer: { layer: "next_card" } }, ui: { x: 40, y: 700 } } },
  { op: "addPatch", patch: { id: "next_pressed", type: "switch", name: "Next Card Pressed", ui: { x: 260, y: 700 } } },
  { op: "addPatch", patch: { id: "press_spring", type: "popAnimation", name: "Press Spring", typeParam: "number", ui: { x: 480, y: 700 } } },
  { op: "addPatch", patch: { id: "press_scale", type: "transition", name: "Press Scale", typeParam: "number", inputs: { start: 1, end: 0.95 }, ui: { x: 720, y: 700 } } },
  { op: "connect", from: "press_next.tap", to: "next_pressed.flip" },
  { op: "connect", from: "next_pressed.on", to: "press_spring.number" },
  { op: "connect", from: "press_spring.output", to: "press_scale.progress" },
  { op: "connect", from: "press_scale.output", to: "@next_card.scale" },
];

describe("app host documents", () => {
  it("describes the live document", async () => {
    const w = editorWindow(1);
    const host = appHost([w]);
    expect(host.kind).toBe("app");
    expect(host.capabilities).toEqual({ screenshots: true, selection: true, presence: true, autosave: false, sfSymbols: false, designPreview: true });
    expect(await host.listDocuments()).toEqual([{ docId: "photo_zoom", name: "Photo Zoom", revision: 0, dirty: false, active: true }]);
    const snap = await host.getDocument();
    expect(snap).toMatchObject({ docId: "photo_zoom", revision: 0, dirty: false, doc: { project: { name: "Photo Zoom" } } });
    expect(snap.doc.components.main!.patches.tap_photo).toBeDefined();
    expect(await host.getDocument("photo_zoom")).toMatchObject({ docId: "photo_zoom" });
    expect(await host.diagnostics()).toMatchObject({ docId: "photo_zoom", revision: 0, diagnostics: expect.any(Array) });
    expect(await rejection(host.getDocument("nope"))).toMatchObject({ code: "unknown_document", hint: expect.stringContaining("photo_zoom") });
  });

  it("names several windows apart and forgets closed ones", async () => {
    const a = editorWindow(1);
    const b = editorWindow(2);
    const windows = [a, b];
    const host = appHost(windows);
    const docs = await host.listDocuments();
    expect(docs.map((d) => [d.docId, d.active])).toEqual([
      ["photo_zoom", true],
      ["photo_zoom_2", false],
    ]);
    await host.apply([{ op: "setProject", changes: { name: "Second" } }], { docId: "photo_zoom_2", label: "renamed", author: CLAUDE });
    expect(b.session.document.getState().doc.project.name).toBe("Second");
    expect(a.session.document.getState().doc.project.name).toBe("Photo Zoom");
    windows.pop();
    expect(await host.listDocuments()).toHaveLength(1);
    expect(await rejection(host.getDocument("photo_zoom_2"))).toMatchObject({ code: "unknown_document" });
  });

  it("reports opened, changed and closed documents once per revision", async () => {
    const w = editorWindow(1);
    const changes: DocumentChange[] = [];
    const host = appHost([w], { onDocumentChange: (change) => changes.push(change) });
    const start = w.session.document.getState().revision;

    await host.documentChanged(1, start);
    expect(changes).toEqual([{ kind: "opened", docId: "photo_zoom", revision: start, targetId: 1 }]);
    await host.documentChanged(99, start + 1);
    expect(changes).toHaveLength(1);

    const applied = await host.apply([{ op: "setInput", target: "photo_scale.end", value: 1.4 }], { label: "bigger zoom", author: CLAUDE });
    expect(changes.at(-1)).toEqual({ kind: "changed", docId: "photo_zoom", revision: applied.revision, targetId: 1 });
    const count = changes.length;
    await host.documentChanged(1, applied.revision);
    expect(changes).toHaveLength(count);
    await host.documentChanged(1, applied.revision + 1);
    expect(changes.at(-1)).toEqual({ kind: "changed", docId: "photo_zoom", revision: applied.revision + 1, targetId: 1 });

    host.forgetTarget(1);
    expect(changes.at(-1)).toMatchObject({ kind: "closed", docId: "photo_zoom", targetId: 1 });
  });

  it("asks the reloaded editor again when its page went away under document.info, but never repeats a write", async () => {
    const w = editorWindow(1);
    const invoke = w.target.invoke;
    const cutOff: string[] = [];
    // The page crashes under the next document.info and the next document.apply.
    w.target.invoke = <T>(method: string, params?: unknown, opts?: { timeoutMs?: number }): Promise<T> => {
      if ((method === "document.info" || method === "document.apply") && !cutOff.includes(method)) {
        cutOff.push(method);
        return Promise.reject({ code: "page_gone", message: `The editor crashed before it answered ${method}`, data: { reason: "crashed" } });
      }
      return invoke<T>(method, params, opts);
    };
    const host = appHost([w]);
    expect(await host.listDocuments()).toMatchObject([{ docId: "photo_zoom" }]);
    const before = w.session.document.getState().revision;
    expect(await rejection(host.apply([{ op: "setInput", target: "photo_scale.end", value: 1.4 }], { label: "bigger zoom", author: CLAUDE }))).toMatchObject({ code: "editor_reloaded" });
    expect(w.session.document.getState().revision).toBe(before);
  });

  it("explains missing windows and editors without the bridge", async () => {
    const none = appHost([]);
    expect(await none.listDocuments()).toEqual([]);
    expect(await rejection(none.getDocument())).toMatchObject({ code: "no_window", hint: expect.stringContaining("open a prototype") });
    expect(await rejection(none.apply(pressChain, { label: "x", author: CLAUDE }))).toMatchObject({ code: "no_window" });

    const placeholder = editorWindow(9, { handlers: false });
    const host = appHost([placeholder]);
    expect(await host.listDocuments()).toEqual([]);
    expect(await rejection(host.getDocument())).toMatchObject({ code: "editor_not_connected", hint: expect.stringContaining("npm run build -w @sonobe/editor") });

    expect(hostErrorFromRpc({ code: "timeout", message: "late" }, "document.get")).toMatchObject({ code: "editor_timeout" });
    expect(hostErrorFromRpc({ code: "renderer_gone", message: "gone" }, "document.get")).toMatchObject({ code: "window_closed" });
    expect(hostErrorFromRpc({ code: "page_gone", message: "The editor crashed before it answered document.apply", data: { reason: "crashed" } }, "document.apply")).toMatchObject({
      code: "editor_reloaded",
      message: "The Sonobe window's editor crashed before it answered document.apply, so the call may not have finished.",
      hint: expect.stringContaining("list_documents"),
    });
    expect(hostErrorFromRpc({ code: "no_viewer", message: "No viewer", data: { hint: "Show it", ok: true } }, "viewer.bounds")).toMatchObject({ code: "no_viewer", message: "No viewer", hint: "Show it", data: undefined });
  });
});

describe("app host writes", () => {
  it("applies ops through the editor's history as Claude", async () => {
    const w = editorWindow(1);
    const host = appHost([w]);
    const result = await host.apply(pressChain, { label: "added press feedback", author: CLAUDE });
    expect(result).toMatchObject({ ok: true, docId: "photo_zoom", revision: 1, dryRun: false, txnId: expect.any(String), affected: { patches: expect.arrayContaining(["press_next", "press_scale"]) } });
    expect(result.applied).toHaveLength(pressChain.length);
    expect(result.diagnostics.totals.errors).toBe(0);

    const state = w.session.document.getState();
    expect(state.doc.components.main!.patches.press_spring).toBeDefined();
    expect(state.historyEntries()[0]).toMatchObject({ txnId: result.txnId, description: "Claude: added press feedback (8 ops)" });
    expect(w.session.presence.getState().recent[0]).toMatchObject({ kind: "apply", description: expect.stringContaining("Claude: added press feedback") });

    expect(await host.history.list({})).toMatchObject([{ txnId: result.txnId, summary: "Claude: added press feedback (8 ops)", author: CLAUDE, opCount: pressChain.length }]);
    expect(await host.history.list({ author: "human" })).toEqual([]);
    expect((await host.getDocument()).revision).toBe(1);
  });

  it("reuses the editor's diagnostics instead of diagnosing copies of the document", async () => {
    const w = editorWindow(1);
    const host = appHost([w]);
    await host.getDocument();
    vi.mocked(getDiagnostics).mockClear();
    const committed = await host.apply(pressChain, { label: "added press feedback", author: CLAUDE });
    expect(committed.ok).toBe(true);
    const committedDoc = w.session.document.getState().doc;
    const preview = await host.apply([{ op: "addPatch", patch: { id: "lonely", type: "switch", ui: { x: 0, y: 900 } } }], { label: "preview", author: CLAUDE, dryRun: true });
    const listed = await host.diagnostics(undefined);
    const undone = await host.history.undo({ author: CLAUDE });
    expect(vi.mocked(getDiagnostics)).not.toHaveBeenCalled();

    // Same answers as diagnosing here.
    expect(listed.diagnostics).toEqual(getDiagnostics(committedDoc, registry));
    expect(preview.diagnostics.added.map((d) => d.code)).toContain("unused_patch");
    expect(preview.diagnostics.totals).toEqual({ ...committed.diagnostics.totals, info: committed.diagnostics.totals.info + 1 });
    expect(undone.undone).toHaveLength(1);
    expect(undone.diagnostics.totals.errors).toBe(0);
  });

  it("adds what the live viewer's prototype reports, read fresh on every call", async () => {
    const w = editorWindow(1);
    const host = appHost([w]);
    w.session.runtime.stepFrame();
    const before = await host.diagnostics();
    expect(before.runtime).toMatchObject({ playing: false, diagnostics: [] });
    // Dots bound to a 3-item grid and to a Loop Select that picks past the end of its 1-item loop.
    const dots: Op[] = [
      { op: "addPatch", patch: { id: "dot_rows", type: "loop", inputs: { count: 3 }, ui: { x: 0, y: 1000 } } },
      { op: "addPatch", patch: { id: "dot_grid", type: "gridLayout", inputs: { index: { link: "dot_rows.index" }, columns: 1 }, ui: { x: 200, y: 1000 } } },
      { op: "addPatch", patch: { id: "dot_pick", type: "loopSelect", typeParam: "number", inputs: { loop: { loop: [1] }, index: { loop: [2, 3] } }, ui: { x: 200, y: 1100 } } },
      { op: "addLayer", layer: { id: "dots", type: "rectangle", name: "Dots", props: { position: { link: "dot_grid.position" }, size: [10, 10], opacity: { link: "dot_pick.output" } } } },
    ];
    expect((await host.apply(dots, { label: "dots", author: CLAUDE })).ok).toBe(true);
    w.session.runtime.stepFrame();
    w.session.runtime.stepFrame();
    const after = await host.diagnostics();
    expect(after.runtime?.frame).toBeGreaterThan(before.runtime!.frame);
    expect(after.runtime?.diagnostics).toEqual([
      expect.objectContaining({ code: "empty_loop", severity: "warning", component: "main", itemIds: ["dots"], hint: expect.stringContaining("empty loop"), suggestions: expect.arrayContaining([expect.objectContaining({ ops: [expect.objectContaining({ target: "dot_pick.outOfRange" })] })]) }),
    ]);
    // An older editor build without the method: the section is left out.
    const old = editorWindow(2);
    old.target.hasMethod = (method) => method !== "viewer.diagnostics" && old.server.methods().includes(method);
    expect((await appHost([old]).diagnostics()).runtime).toBeUndefined();
  });

  it("previews dry runs, reports errors, and refuses stale revisions", async () => {
    const w = editorWindow(1);
    const host = appHost([w]);
    const dry = await host.apply(pressChain, { label: "try", author: CLAUDE, dryRun: true });
    expect(dry).toMatchObject({ ok: true, dryRun: true, revision: 0 });
    expect(dry.preview?.components.main!.patches.press_scale).toBeDefined();
    expect(dry.txnId).toBeUndefined();
    expect(w.session.document.getState().historyEntries()).toHaveLength(0);

    const broken = await host.apply([{ op: "removePatch", id: "ghost" }], { label: "remove ghost", author: CLAUDE });
    expect(broken).toMatchObject({ ok: false, revision: 0, errors: [{ code: "not_found" }] });

    w.session.document.getState().apply([{ op: "setProject", changes: { name: "Edited by a person" } }], { label: "Rename" });
    const stale = await host.apply(pressChain, { label: "late", author: CLAUDE, expectedRevision: 0 });
    expect(stale).toMatchObject({ ok: false, conflict: { expectedRevision: 0, currentRevision: 1 }, errors: [{ code: "revision_conflict" }] });
    expect(w.session.document.getState().doc.components.main!.patches.press_next).toBeUndefined();
  });

  it("undoes Claude's changes but won't discard a person's edits without asking", async () => {
    const w = editorWindow(1);
    const host = appHost([w]);
    const first = await host.apply(pressChain, { label: "added press feedback", author: CLAUDE });
    w.session.document.getState().apply([{ op: "updateLayer", id: "card", props: { position: [16, 150] } }], { label: "Move Card" });

    expect(await rejection(host.history.undo({ author: CLAUDE }))).toMatchObject({ code: "human_edit", message: expect.stringContaining("Move Card") });
    expect(await rejection(host.history.undo({ author: CLAUDE, txnId: first.txnId! }))).toMatchObject({ code: "human_edit" });
    expect(await rejection(host.history.undo({ author: CLAUDE, txnId: "txn_nope" }))).toMatchObject({ code: "not_found" });

    const undone = await host.history.undo({ author: CLAUDE, txnId: first.txnId!, allowHumanEdits: true });
    expect(undone).toMatchObject({ docId: "photo_zoom", revision: 4, undone: [{ label: "Move Card" }, { label: "added press feedback" }] });
    expect(w.session.document.getState().doc.components.main!.patches.press_next).toBeUndefined();
    expect(await rejection(host.history.undo({ author: CLAUDE }))).toMatchObject({ code: "nothing_to_undo" });
  });

  it("reports the ids the editor created, even when names were retired", async () => {
    const w = editorWindow(1);
    const host = appHost([w]);
    const sticker = [{ op: "addLayer", layer: { type: "rectangle", name: "Sticker" } }] as Op[];
    await host.apply(sticker, { label: "add sticker", author: CLAUDE });
    await host.apply([{ op: "removeLayer", id: "sticker" }], { label: "remove sticker", author: CLAUDE });
    const again = await host.apply(sticker, { label: "add sticker", author: CLAUDE });
    const layerId = (r: { applied: Op[] }) => (r.applied[0] as Extract<Op, { op: "addLayer" }>).layer.id;
    expect(layerId(again)).toBe("sticker_2");
    expect(again.results[0]!.ids).toEqual(["sticker_2"]);
    expect(again.txnId).toBe(w.session.document.getState().historyEntries()[0]!.txnId);
    expect(writeResult(again).structuredContent).toMatchObject({ created: ["sticker_2"], retiredIds: { sticker_2: "sticker" } });
    expect(writeResult(again).content[0]).toMatchObject({ text: expect.stringContaining("Retired ids skipped: sticker → sticker_2.") });
    // The editor's retired ids reach the snapshot import_design plans against.
    expect((await host.getDocument()).retired).toEqual({ main: ["sticker"] });

    const dry = await host.apply(sticker, { label: "try", author: CLAUDE, dryRun: true });
    expect(layerId(dry)).toBe("sticker_3");
    expect(findLayer(dry.preview!.components.main!.layers, "sticker_3")).toBeDefined();
    expect(writeResult(dry).content[0]).toMatchObject({ text: expect.stringContaining("Would create: sticker_3") });
  });

  it("won't undo a person's edit that lands just before the undo runs, and lists everything it undid", async () => {
    const w = editorWindow(1);
    const host = appHost([w]);
    const agent = await host.apply([{ op: "addPatch", patch: { type: "switch", id: "agent_switch" } }], { label: "add switch", author: CLAUDE });
    const invoke = w.target.invoke;
    let armed = true;
    w.target.invoke = <T>(method: string, params?: unknown, opts?: { timeoutMs?: number }) => {
      if (method === "history.undo" && armed) {
        armed = false;
        // The person drags in a layer while the agent's undo is on its way to the editor.
        w.session.document.getState().apply([{ op: "addLayer", layer: { type: "rectangle", id: "human_rect", name: "Human Rect" } }], { label: "Add Human Rect" });
      }
      return invoke<T>(method, params, opts);
    };
    expect(await rejection(host.history.undo({ author: CLAUDE, txnId: agent.txnId! }))).toMatchObject({ code: "human_edit", hint: expect.stringContaining("allowHumanEdits") });
    const s = w.session.document.getState();
    expect(findLayer(s.doc.components.main!.layers, "human_rect")).toBeDefined();
    expect(s.redoEntries()).toEqual([]);

    const both = await host.history.undo({ author: CLAUDE, txnId: agent.txnId!, allowHumanEdits: true });
    expect(both.undone.map((u) => u.summary)).toEqual(["You: Add Human Rect", "Claude: add switch"]);
    expect(both.undone[0]).toMatchObject({ author: { kind: "human" }, opCount: 1, revision: expect.any(Number), timestamp: expect.any(Number) });
  });

  /** The browser host's paths stand in for folders on disk: "~/Documents/Deck.sonobe" saves as "browser:Deck". */
  const browserTargets = (targets: string[] = []): Partial<AppHostOptions> => ({
    defaultProjectDir: async (name) => `~/Documents/${name}.sonobe`,
    newProjectTarget: async (input) => {
      targets.push(input);
      if (input.includes("inside.sonobe/")) throw new HostError("inside_project", `${input} would be inside the project inside.sonobe.`, { hint: "Save it next to that project instead." });
      return `browser:${path.basename(input, ".sonobe")}`;
    },
  });

  it("passes save_document's force through and explains pending outside changes", async () => {
    const w = editorWindow(1);
    const host = appHost([w], browserTargets());
    await host.saveDocument();
    const store = w.session.document;
    store.getState().apply([{ op: "setInput", target: "photo_scale.end", value: 1.4 }], { label: "bigger zoom" });
    store.setState({ externalChange: { path: store.getState().projectPath!, paths: ["components/main.json"], document: store.getState().doc, detectedAt: 5 } });
    expect(await rejection(host.saveDocument())).toMatchObject({ code: "disk_changed", hint: expect.stringContaining("force: true") });
    expect(store.getState().dirty).toBe(true);
    expect(await host.saveDocument(undefined, { force: true })).toMatchObject({ docId: "photo_zoom", path: "browser:Photo Zoom", written: ["components/main.json"] });
    expect(store.getState()).toMatchObject({ dirty: false, externalChange: null });
  });

  it("saves without ever asking the person where: the name picks a folder, and Untitled needs a path", async () => {
    const w = editorWindow(1);
    const targets: string[] = [];
    const host = appHost([w], browserTargets(targets));
    const store = w.session.document;

    // A named prototype that was never saved goes to ~/Documents/<Name>.sonobe, checked like any agent path.
    const saved = await host.saveDocument();
    expect(saved).toMatchObject({ docId: "photo_zoom", path: "browser:Photo Zoom", revision: 0, removed: [] });
    expect(saved.written).toEqual(expect.arrayContaining(["project.json", "components/main.json"]));
    expect(targets).toEqual(["~/Documents/Photo Zoom.sonobe"]);
    expect((await host.listDocuments())[0]).toMatchObject({ path: "browser:Photo Zoom", dirty: false });

    // "Untitled" says nothing about where it belongs, so no folder is made up for it.
    store.getState().newDocument();
    store.getState().apply([{ op: "addLayer", layer: { type: "rectangle", name: "Card" } }], { label: "Add Card" });
    expect(await rejection(host.saveDocument())).toMatchObject({ code: "path_needed", hint: expect.stringContaining("save_document({ path") });
    expect(store.getState()).toMatchObject({ projectPath: null, dirty: true });

    // A path the rules refuse comes back as the rule's error; a good one saves there and names the prototype.
    expect(await rejection(host.saveDocument(undefined, { path: "~/Documents/inside.sonobe/Deck.sonobe" }))).toMatchObject({ code: "inside_project" });
    expect(await host.saveDocument(undefined, { path: "~/Documents/Placemark Deck.sonobe" })).toMatchObject({ path: "browser:Placemark Deck" });
    expect(store.getState()).toMatchObject({ projectPath: "browser:Placemark Deck", dirty: false });
    expect(store.getState().doc.project.name).toBe("Placemark Deck");

    // Save As a saved project goes to the new folder too.
    expect(await host.saveDocument(undefined, { path: "~/Documents/Copy.sonobe" })).toMatchObject({ path: "browser:Copy" });
    expect(w.names.asked).toBe(0);
  });

  it("opens and creates documents", async () => {
    const w = editorWindow(1);
    const host = appHost([w]);
    expect(await host.openDocument("photo_zoom")).toMatchObject({ docId: "photo_zoom", active: true });
    expect(w.focused).toBe(1);
    expect(await rejection(host.openDocument("relative/Checkout.sonobe"))).toMatchObject({ code: "not_a_project" });
    expect(await rejection(host.openDocument("/Users/test/not-a-project"))).toMatchObject({ code: "not_a_project" });
    // The browser host can't read disk paths, so the editor's own open error comes back.
    expect(await rejection(host.openDocument("/Users/test/Checkout.sonobe"))).toMatchObject({ code: "open_failed" });

    expect(await rejection(host.createDocument({ template: "nope" }))).toMatchObject({ code: "unknown_template" });
    expect(await rejection(host.createDocument({ path: "Checkout.sonobe" }))).toMatchObject({ code: "absolute_path_required" });
    expect(await host.createDocument({ name: "Checkout", template: "blank", open: false })).toEqual({ docId: "checkout", name: "Checkout", path: "/Users/test/Documents/Checkout.sonobe", revision: 0, dirty: false, active: false });
    expect(host.written).toEqual(["/Users/test/Documents/Checkout.sonobe"]);
    expect(await rejection(host.createDocument({ path: "/Users/test/Checkout.sonobe" }))).toMatchObject({ code: "open_failed" });

    const exists = appHost([w], { projectExists: async () => true });
    expect(await rejection(exists.createDocument({ name: "Checkout" }))).toMatchObject({ code: "already_exists" });
  });
});

describe("app host presence, selection and screenshots", () => {
  it("reveals items, reads the selection, and shows working badges", async () => {
    const w = editorWindow(1);
    const host = appHost([w]);
    w.session.selection.getState().select({ layers: ["card"] });
    expect(await host.reveal(["card", "zoomed", "ghost"], {})).toEqual({ revealed: true, component: "main", reason: "Not found: ghost." });
    expect(w.focused).toBe(0);
    // Revealing shows items without replacing the person's selection; getSelection reads it.
    expect(await host.getSelection()).toEqual({ docId: "photo_zoom", component: "main", layers: ["card"], patches: [], comments: [] });
    // Focus takes the person there: it selects what it reveals and raises the window.
    expect(await host.reveal(["card", "zoomed"], { focus: true })).toEqual({ revealed: true, component: "main" });
    expect(w.focused).toBe(1);
    expect(await host.getSelection()).toMatchObject({ layers: ["card"], patches: ["zoomed"] });
    expect(await host.reveal(["ghost"], {})).toMatchObject({ revealed: false, reason: expect.stringContaining("ghost") });

    await host.setWorking({ ids: ["card"], intent: "Tuning the zoom spring" }, { author: CLAUDE });
    expect(w.session.presence.getState().working).toMatchObject([{ intent: "Tuning the zoom spring", ids: ["card"], author: CLAUDE }]);
    expect(await host.presence()).toMatchObject([{ intent: "Tuning the zoom spring", author: CLAUDE }]);
    await host.setWorking({ ids: [], intent: "Checking the result" }, { author: CLAUDE });
    expect(w.session.presence.getState().working).toMatchObject([{ intent: "Checking the result" }]);
    await host.setWorking(null, { author: CLAUDE });
    expect(w.session.presence.getState().working).toEqual([]);
    expect(await host.presence()).toEqual([]);
  });

  it("reveals inside a component the person isn't viewing only with focus", async () => {
    const w = editorWindow(1);
    const host = appHost([w]);
    const made = await host.apply([...pressChain, { op: "createComponent", name: "Press Motion", ref: "motion", patchIds: ["next_pressed", "press_spring"] }], { label: "setup", author: CLAUDE });
    expect(made.ok).toBe(true);
    const motion = made.idMap.motion!;
    // Without focus the person stays on Main, so the honest answer is "not revealed", with the way to do it.
    expect(await host.reveal(["press_spring"], { component: motion })).toEqual({
      revealed: false,
      component: motion,
      reason: "press_spring is inside Press Motion, and the person is viewing Main. Pass focus: true to open Press Motion for them.",
    });
    expect(w.session.selection.getState().componentPath).toEqual(["main"]);
    expect(w.focused).toBe(0);
    // With focus the editor opens the component (found without naming it), selects and reveals.
    expect(await host.reveal(["press_spring"], { focus: true })).toEqual({ revealed: true, component: motion, opened: true });
    expect(w.session.selection.getState()).toMatchObject({ componentPath: ["main", motion], patches: ["press_spring"] });
    expect(w.focused).toBe(1);
  });

  it("reads the patch editor's measured node boxes for the component it shows, at the current revision", async () => {
    const w = editorWindow(1);
    const host = appHost([w]);
    expect(await host.graphGeometry!({ component: "main" })).toBeNull();
    const { revision } = await host.getDocument();
    let shown = "main";
    let drawnRevision = revision;
    w.session.graphGeometry.register(({ component }) => ({
      component: component ?? shown,
      shownComponent: shown,
      revision: drawnRevision,
      nodes: [
        ["zoomed", 40, 60, 212.4, 74, 1],
        ["@card", 400, 20, 180, 96, 0],
      ],
    }));
    expect(await host.graphGeometry!({ component: "main" })).toEqual({
      docId: "photo_zoom",
      component: "main",
      revision,
      nodes: { zoomed: { x: 40, y: 60, width: 212.4, height: 74, measured: true }, "@card": { x: 400, y: 20, width: 180, height: 96, measured: false } },
    });
    // Boxes of an older revision, or of another component, don't count.
    drawnRevision = revision - 1;
    expect(await host.graphGeometry!({ component: "main" })).toBeNull();
    drawnRevision = revision;
    shown = "other";
    expect(await host.graphGeometry!({ component: "main" })).toBeNull();
    shown = "main";

    // Layout tools lay the measured sizes over their estimates, and editor positions for layer nodes.
    const snap = await host.getDocument();
    const estimate = estimateGraphGeometry(snap.doc, registry, "main");
    const resolved = await resolveGraphGeometry(host, snap, "main");
    expect(resolved.nodes.get("zoomed")).toEqual({ ...estimate.nodes.get("zoomed"), width: 213, height: 74 });
    expect(resolved.nodes.get("@card")).toEqual({ ...estimate.nodes.get("@card"), x: 400, y: 20 });
    expect([...resolved.measured]).toEqual(["zoomed"]);
  });

  it("keeps one working badge per session, so one session's finish doesn't clear another's", async () => {
    const w = editorWindow(1);
    const host = appHost([w]);
    const placemark = { id: "11111111-aaaa-4bbb-8ccc-000000000001", label: "Claude Code", folder: "/Users/me/placemark" };
    const sonobe = { id: "22222222-aaaa-4bbb-8ccc-000000000002", label: "Claude Code", folder: "/Users/me/sonobe" };
    await host.setWorking({ ids: ["card"], intent: "Tuning the deck" }, { author: CLAUDE, client: placemark });
    await host.setWorking({ ids: [], intent: "Adding a tab bar" }, { author: CLAUDE, client: sonobe });
    expect(w.session.presence.getState().working).toMatchObject([
      { intent: "Tuning the deck", client: placemark },
      { intent: "Adding a tab bar", client: sonobe },
    ]);
    await host.setWorking(null, { author: CLAUDE, client: placemark });
    expect(w.session.presence.getState().working).toMatchObject([{ intent: "Adding a tab bar" }]);
    // A finish the host has no badge for (after an editor reload) still only clears that session's.
    await host.setWorking(null, { author: CLAUDE, client: placemark });
    expect(w.session.presence.getState().working).toHaveLength(1);
    await host.setWorking(null, { author: CLAUDE, client: sonobe });
    expect(await host.presence()).toEqual([]);
  });

  it("draws a design preview in the window that shows its document, and lets a missing window go", async () => {
    const a = editorWindow(1);
    const b = editorWindow(2);
    const host = appHost([a, b]);
    const [, second] = await host.listDocuments();
    const seen: { window: number; params: unknown }[] = [];
    for (const [w, id] of [[a, 1], [b, 2]] as const) w.server.handle("design.preview", (params) => void seen.push({ window: id, params }));
    const placemark = { id: "11111111-aaaa-4bbb-8ccc-000000000001", label: "Claude Code", folder: "/Users/me/placemark" };
    const update: DesignPreviewUpdate = { docId: second!.docId, key: placemark.id, author: CLAUDE, client: placemark, name: "Checkout", component: null, replace: null, width: null, height: null, position: null, html: "<body>Checkout", status: "writing", draftRevision: 1 };
    await host.showDesignPreview!(update);
    expect(seen).toEqual([{ window: 2, params: update }]);
    // preview_design reaches it the same way, as the session's draft.
    const server = createSonobeMcpServer(host, { version: "0.1.0-test" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "claude-code", version: "2.1.278" });
    await client.connect(clientSide as never);
    cleanups.push(() => client.close());
    const shown = await client.callTool({ name: "preview_design", arguments: { name: "Inbox", html: "<body>Inbox</body>" } });
    expect(JSON.stringify(shown.content)).toContain("Showing “Inbox” on the canvas");
    expect(seen.at(-1)).toMatchObject({ window: 1, params: { docId: "photo_zoom", key: "Claude", name: "Inbox", html: "<body>Inbox</body>", status: "writing", draftRevision: 1 } });

    // A window that's gone has nothing to draw on, and that's not an error.
    await expect(host.showDesignPreview!({ ...update, docId: "gone" })).resolves.toBeUndefined();
    await expect(appHost([]).showDesignPreview!(update)).resolves.toBeUndefined();
    expect(seen).toHaveLength(2);
    // An editor without design.preview says so; there's nothing of its to clear.
    const old = editorWindow(3);
    old.target.hasMethod = (method) => method !== "design.preview" && old.server.methods().includes(method);
    const oldHost = appHost([old]);
    expect(await rejection(oldHost.showDesignPreview!({ ...update, docId: "photo_zoom" }))).toMatchObject({ code: "design_preview_unavailable", hint: expect.stringContaining('"preview": true') });
    await expect(oldHost.showDesignPreview!({ ...update, docId: "photo_zoom", status: "cleared", html: null })).resolves.toBeUndefined();
  });

  it("puts preview_design's draft on the editor's canvas, and import_design with preview adds it as layers", async () => {
    // The editor's design.preview params mirror the MCP host's update field for field.
    expectTypeOf<EditorDesignPreviewUpdate>().toEqualTypeOf<DesignPreviewUpdate>();
    designStore.setState(initialDesignData());
    cleanups.push(() => designStore.setState(initialDesignData()));
    const w = editorWindow(1);
    const captured: { html: string | undefined; status: string | undefined }[] = [];
    const host = appHost([w], {
      captureDesign: async (request) => {
        // import_design says it's adding the draft while it renders it.
        captured.push({ html: request.html, status: activeDraft(designStore.getState(), Date.now())?.status });
        return { capture: CHECKOUT_CAPTURE as never, images: new Map() };
      },
    });
    const server = createSonobeMcpServer(host, { version: "0.1.0-test" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "claude-code", version: "2.1.278" });
    await client.connect(clientSide as never);
    cleanups.push(() => client.close());
    const draft = () => activeDraft(designStore.getState(), Date.now());

    const head = '<!doctype html><html><head><style>body{margin:0}</style></head><body><header data-name="Header">Checkout</header>';
    await client.callTool({ name: "preview_design", arguments: { name: "Checkout", html: head } });
    expect(draft()).toMatchObject({ source: "mcp", key: "mcp:Claude", status: "writing", html: head, fields: { name: "Checkout" }, mcp: { author: CLAUDE, draftRevision: 1 } });
    const pay = '<div data-name="Pay Button">Pay</div></body></html>';
    await client.callTool({ name: "preview_design", arguments: { append: pay } });
    expect(draft()).toMatchObject({ status: "writing", html: head + pay, mcp: { draftRevision: 2 } });

    const result = await client.callTool({ name: "import_design", arguments: { preview: true } });
    expect(result.isError).not.toBe(true);
    expect(captured).toEqual([{ html: head + pay, status: "adding" }]);
    // The import went in before the draft was cleared, so it ends as added and fades.
    expect(designStore.getState().drafts.at(-1)).toMatchObject({ key: "mcp:Claude", status: "added", mcp: { draftRevision: 4 } });
    const root = w.session.document.getState().doc.project.root;
    expect(w.session.document.getState().doc.components[root]!.layers.map((l) => l.name)).toContain("Checkout");
  });

  it("restarts the live prototype (restart_viewer) and says what the players show", async () => {
    const w = editorWindow(1);
    const host = appHost([w]);
    const restarts = vi.fn();
    w.session.runtime.subscribeRestart(restarts);
    for (let i = 0; i < 5; i++) w.session.runtime.stepFrame();
    expect(w.session.runtime.runtime.frame).toBe(4);
    expect(await host.restartViewer!({})).toEqual({ docId: "photo_zoom", playing: false });
    expect(restarts).toHaveBeenCalledTimes(1);
    w.session.runtime.stepFrame();
    expect(w.session.runtime.runtime.frame).toBe(0);
    // The desktop restarts phones only for the window whose document they show, and holds scripts the editor holds.
    expect(host.activeTargetId()).toBe(1);
    expect(host.scriptsPaused("photo_zoom")).toBe(false);
    expect(await rejection(host.restartViewer!({ docId: "missing_doc" }))).toMatchObject({ code: "unknown_document" });

    const old = editorWindow(2);
    old.target.hasMethod = (method) => method !== "viewer.restart" && old.server.methods().includes(method);
    expect(await rejection(appHost([old]).restartViewer!({}))).toMatchObject({ code: "viewer_restart_unavailable", hint: expect.stringContaining("Restart Prototype") });
  });

  it("adds the restart offer to the Live viewer diagnostics", async () => {
    const w = editorWindow(1);
    const host = appHost([w]);
    w.session.runtime.stepFrame();
    w.session.runtime.state.setState({ staleState: { layerId: "card", copies: 1 } });
    expect((await host.diagnostics()).runtime?.diagnostics).toEqual([
      expect.objectContaining({ code: "stale_state", severity: "info", component: "main", itemIds: ["card"], message: expect.stringContaining('kept state from before the last edit: it draws no copies of Layer "Event Card"'), hint: expect.stringContaining("restart_viewer") }),
    ]);
  });

  it("crops screenshots to the visible viewer stage", async () => {
    const w = editorWindow(1);
    const host = appHost([w]);
    expect(await rejection(host.screenshot({ kind: "viewer" }, {}))).toMatchObject({ code: "no_viewer", hint: expect.stringContaining("Viewer") });

    w.server.handle("viewer.bounds", () => ({ x: 100, y: 50, width: 400, height: 900, stage: { x: 105, y: 40, width: 201, height: 437 }, scale: 0.5, devicePixelRatio: 2, prototypeSize: [402, 874] }));
    const shot = await host.screenshot({ kind: "viewer" }, { maxWidth: 800 });
    expect(shot).toEqual({ data: "iVBORw0KGgo=", mimeType: "image/png", width: 402, height: 854 });
    expect(w.captures[0]).toEqual({ rect: { x: 105, y: 50, width: 201, height: 427 }, size: { width: 402, height: 854 } });
    await host.screenshot({ kind: "viewer" }, { scale: 2, maxWidth: 400 });
    expect(w.captures[1]!.size).toEqual({ width: 400, height: 850 });

    // A viewer zoomed by CSS outside the renderer reports scale 1; the measured stage still gives points.
    w.server.handle("viewer.bounds", () => ({ x: 263, y: 128, width: 236.04, height: 513.17, stage: { x: 263, y: 128, width: 236.04, height: 513.17 }, scale: 1, devicePixelRatio: 2, prototypeSize: [402, 874] }));
    expect(await host.screenshot({ kind: "viewer" }, { maxWidth: 800 })).toMatchObject({ width: 402, height: 874 });
    w.captures.length = 0;

    expect(await rejection(host.screenshot({ kind: "viewer" }, { simId: "sim_1" }))).toMatchObject({ code: "sim_screenshot_unavailable" });
    expect(await rejection(host.screenshot({ kind: "graph" }, {}))).toMatchObject({ code: "target_unavailable", hint: expect.stringContaining("get_outline") });
    expect(await rejection(host.screenshot({ kind: "layer", layerId: "card" }, {}))).toMatchObject({ code: "target_unavailable" });

    w.server.handle("graph.bounds", () => ({ x: 600, y: 60, width: 500, height: 300 }));
    expect(await host.screenshot({ kind: "graph" }, { maxWidth: 250 })).toMatchObject({ width: 250, height: 150 });

    // Layers are clipped to the visible stage and sized in points from the viewer's measured scale.
    w.server.handle("viewer.bounds", () => ({ x: 100, y: 50, width: 400, height: 900, stage: { x: 105, y: 40, width: 201, height: 437 }, scale: 1, devicePixelRatio: 2, prototypeSize: [402, 874] }));
    w.server.handle("viewer.layerBounds", (params) => ((params as { layerId?: string }).layerId === "card" ? { x: 110, y: 30, width: 100, height: 60 } : null));
    w.captures.length = 0;
    expect(await host.screenshot({ kind: "layer", layerId: "card" }, {})).toMatchObject({ width: 200, height: 80 });
    expect(w.captures[0]).toEqual({ rect: { x: 110, y: 50, width: 100, height: 40 }, size: { width: 200, height: 80 } });

    w.captureResult = "empty";
    expect(await rejection(host.screenshot({ kind: "viewer" }, {}))).toMatchObject({ code: "capture_failed" });
    w.server.handle("viewer.bounds", () => ({ nope: true }));
    expect(await rejection(host.screenshot({ kind: "viewer" }, {}))).toMatchObject({ code: "editor_error" });
  });
});

const node = (key: string, layerId: string, x: number, y: number, width: number, height: number, children: SceneNode[] = []): SceneNode =>
  ({ key, layerId, type: "rectangle", parentKey: null, x, y, width, height, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1], worldTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1], opacity: 1, children }) as unknown as SceneNode;

describe("app host simulation screenshots", () => {
  const scene: SceneFrame = {
    frame: 12,
    time: 0.2,
    size: [402, 874],
    background: { r: 1, g: 1, b: 1, a: 1 },
    roots: [node("card", "card", 16, 120, 358, 220), node("row#1", "row", 0, 700, 402, 40), node("row#2", "row", 0, 760, 402, 40)],
  };

  it("finds where layers are drawn", () => {
    expect(sceneLayerBounds(scene, "card")).toEqual({ x: 16, y: 120, width: 358, height: 220 });
    expect(sceneLayerBounds(scene, "row")).toEqual({ x: 0, y: 700, width: 402, height: 100 });
    expect(sceneLayerBounds(scene, "row#2")).toEqual({ x: 0, y: 760, width: 402, height: 40 });
    expect(sceneLayerBounds(scene, "ghost")).toBeNull();
  });

  it("draws a simulation's frame when the simulation manager exposes scenes", async () => {
    const w = editorWindow(1);
    const requests: SceneRenderRequest[] = [];
    let drawn = true;
    const host = appHost([w], {
      simulations: (o) => Object.assign(createSimulationManager(o), { sceneAt: () => scene }),
      renderScene: async (request) => {
        requests.push(request);
        return drawn ? { data: "iVBORw0KGgo=", width: request.size.width, height: request.size.height } : null;
      },
    });
    const { simId } = await host.sim.reset({});
    expect(host.simulationScreenshots()).toBe(true);

    expect(await host.screenshot({ kind: "viewer" }, { simId, maxWidth: 201 })).toEqual({ data: "iVBORw0KGgo=", mimeType: "image/png", width: 201, height: 437, timeMs: 200 });
    expect(requests[0]).toMatchObject({ scene, crop: { x: 0, y: 0, width: 402, height: 874 }, size: { width: 201, height: 437 }, assets: {} });
    expect(await host.screenshot({ kind: "layer", layerId: "card" }, { simId, scale: 2 })).toMatchObject({ width: 716, height: 440 });
    expect(requests[1]!.crop).toEqual({ x: 16, y: 120, width: 358, height: 220 });

    expect(await rejection(host.screenshot({ kind: "layer", layerId: "ghost" }, { simId }))).toMatchObject({ code: "not_found" });
    expect(await rejection(host.screenshot({ kind: "graph" }, { simId }))).toMatchObject({ code: "target_unavailable", hint: expect.stringContaining("viewer") });
    drawn = false;
    expect(await rejection(host.screenshot({ kind: "viewer" }, { simId }))).toMatchObject({ code: "capture_failed" });
    expect(w.captures).toEqual([]);
  });

  it("explains that simulation screenshots are unavailable without scenes", async () => {
    const w = editorWindow(1);
    const host = appHost([w], { renderScene: async () => null });
    const { simId } = await host.sim.reset({});
    const hasScene = typeof (createSimulationManager({ registry, getDocument: () => ({ docId: "x", doc: createDemoDocument(registry), revision: 0 }) }) as { sceneAt?: unknown }).sceneAt === "function";
    expect(appHost([w]).simulationScreenshots()).toBe(false);
    if (hasScene) return; // @sonobe/mcp now exposes sceneAt(simId, atMs); the previous test covers drawing.
    expect(host.simulationScreenshots()).toBe(false);
    expect(await rejection(host.screenshot({ kind: "viewer" }, { simId }))).toMatchObject({ code: "sim_screenshot_unavailable" });
  });

  const findNode = (nodes: readonly SceneNode[], id: string): SceneNode | undefined => {
    for (const n of nodes) {
      const found = n.layerId === id ? n : findNode(n.children, id);
      if (found) return found;
    }
    return undefined;
  };

  it("draws the frame atMs later, and one layer alone with isolate", async () => {
    const w = editorWindow(1);
    const requests: SceneRenderRequest[] = [];
    const host = appHost([w], {
      renderScene: async (request) => {
        requests.push(request);
        return { data: "iVBORw0KGgo=", width: request.size.width, height: request.size.height };
      },
    });
    const { simId } = await host.sim.reset({});
    const now = await host.screenshot({ kind: "viewer" }, { simId });
    const later = await host.screenshot({ kind: "viewer" }, { simId, atMs: 2000 });
    expect(later.timeMs! - now.timeMs!).toBe(2000);
    expect(requests[1]!.scene.time - requests[0]!.scene.time).toBeCloseTo(2, 5);
    // The session itself didn't move.
    expect((await host.sim.values(simId, ["zoomed.on"])).frame).toBe(0);

    // A layer target crops the scene; isolate draws only that layer's subtree.
    await host.screenshot({ kind: "layer", layerId: "card" }, { simId });
    expect(findNode(requests[2]!.scene.roots, "next_card")).toBeDefined();
    const alone = await host.screenshot({ kind: "layer", layerId: "card" }, { simId, isolate: true });
    const drawn = requests[3]!;
    expect(drawn.scene.roots.map((n) => n.key)).toEqual(["card"]);
    expect(findNode(drawn.scene.roots, "next_card")).toBeUndefined();
    expect(findNode(drawn.scene.roots, "photo")).toBeDefined();
    expect(drawn.scene.roots[0]!.transform).toEqual(drawn.scene.roots[0]!.worldTransform);
    expect(drawn.crop).toEqual(requests[2]!.crop);
    expect(alone.notes).toBeUndefined();

    // Without simId the live viewer can't isolate a layer, so a fresh run is drawn and the result says so.
    const preview = await host.screenshot({ kind: "layer", layerId: "next_card" }, { isolate: true });
    expect(requests[4]!.scene.roots.map((n) => n.key)).toEqual(["next_card"]);
    expect(preview.notes?.[0]).toContain("The live viewer can't draw one layer alone");
    expect(w.captures).toEqual([]);
    expect(await rejection(host.screenshot({ kind: "layer", layerId: "ghost" }, { isolate: true }))).toMatchObject({ code: "not_found" });
  });

  it("overrides values in a simulation without touching the editor", async () => {
    const w = editorWindow(1);
    const requests: SceneRenderRequest[] = [];
    const host = appHost([w], {
      renderScene: async (request) => {
        requests.push(request);
        return { data: "iVBORw0KGgo=", width: request.size.width, height: request.size.height };
      },
    });
    const before = w.session.document.getState();
    const { simId } = await host.sim.reset({});
    const r = await host.sim.override(simId, {
      set: [
        { target: "@next_card.opacity", value: 0 },
        { target: "@card.opacity", value: 0.25 },
      ],
    });
    expect(r.overrides.map((o) => o.summary)).toEqual(["@next_card.opacity = 0 (was the default 1)", "@card.opacity = 0.25 (was the default 1)"]);
    await host.screenshot({ kind: "viewer" }, { simId });
    expect(findNode(requests[0]!.scene.roots, "next_card")?.opacity).toBe(0);
    expect(findNode(requests[0]!.scene.roots, "card")?.opacity).toBe(0.25);

    const after = w.session.document.getState();
    expect([after.revision, after.canUndo, after.canRedo]).toEqual([before.revision, before.canUndo, before.canRedo]);
    expect(after.doc).toBe(before.doc);
    expect(await host.history.list({})).toEqual([]);

    // The person's edit lands under the overrides.
    await host.apply([{ op: "setInput", target: "photo_scale.end", value: 1.5 }], { label: "bigger zoom", author: CLAUDE });
    const values = await host.sim.values(simId, ["@next_card.opacity", "photo_scale.end"]);
    expect(values).toMatchObject({ documentUpdated: true, values: { "@next_card.opacity": 0 }, notes: { "@next_card.opacity": "overridden in this simulation, was the default 1" } });
    expect((await host.sim.reset({ simId })).clearedOverrides).toHaveLength(2);
  });
});

describe("app host component screenshots", () => {
  /** A window with a patch component (Press Motion) and a layer component (Badge Button). */
  async function withComponents(extra: Partial<AppHostOptions> = {}) {
    const w = editorWindow(1);
    const svgs: { svg: string; size: { width: number; height: number } }[] = [];
    const scenes: SceneRenderRequest[] = [];
    const host = appHost([w], {
      renderSvg: async (request) => {
        svgs.push(request);
        return { data: "iVBORw0KGgo=", width: request.size.width, height: request.size.height };
      },
      renderScene: async (request) => {
        scenes.push(request);
        return { data: "iVBORw0KGgo=", width: request.size.width, height: request.size.height };
      },
      ...extra,
    });
    const made = await host.apply(
      [
        ...pressChain,
        { op: "createComponent", name: "Press Motion", ref: "motion", patchIds: ["next_pressed", "press_spring"] },
        { op: "addLayer", layer: { id: "badge", type: "rectangle", name: "Badge", props: { position: [40, 60], size: [120, 40] } } },
        { op: "createComponent", name: "Badge Button", ref: "button", layerIds: ["badge"] },
      ],
      { label: "setup", author: CLAUDE },
    );
    expect(made.ok).toBe(true);
    return { w, host, svgs, scenes, motion: made.idMap.motion!, button: made.idMap.button! };
  }

  it("captures the patch editor when the person is viewing the component, and draws it from the document otherwise", async () => {
    const { w, host, svgs, motion } = await withComponents();
    w.server.handle("graph.bounds", () => ({ x: 600, y: 60, width: 500, height: 300 }));
    // Viewing Main: Press Motion's graph is drawn from the document, without moving the person.
    const drawn = await host.screenshot({ kind: "graph" }, { component: motion, maxWidth: 500 });
    expect(svgs).toHaveLength(1);
    expect(svgs[0]!.svg).toContain('data-node="press_spring"');
    expect(svgs[0]!.size.width).toBeLessThanOrEqual(500);
    expect(drawn.notes).toEqual([expect.stringContaining("The patch editor isn't showing Press Motion")]);
    expect(w.session.selection.getState().componentPath).toEqual(["main"]);
    expect(w.captures).toEqual([]);
    // Once the person is in it, the editor itself is captured.
    await host.reveal(["press_spring"], { focus: true });
    expect(await host.screenshot({ kind: "graph" }, { component: motion, maxWidth: 250 })).toMatchObject({ width: 250, height: 150 });
    expect(w.captures).toHaveLength(1);
    expect(svgs).toHaveLength(1);
  });

  it("crops a graph to one comment frame from the document, even while the editor shows the component", async () => {
    const { w, host, svgs, motion } = await withComponents();
    w.server.handle("graph.bounds", () => ({ x: 600, y: 60, width: 500, height: 300 }));
    await host.apply([{ op: "addComment", component: motion, comment: { id: "springs", text: "SPRINGS", rect: [100, 80, 300, 200] } }], { label: "frame", author: CLAUDE });
    await host.reveal(["press_spring"], { focus: true });
    const shot = await host.screenshot({ kind: "graph" }, { component: motion, frame: "springs" });
    expect(w.captures).toEqual([]);
    expect(svgs).toHaveLength(1);
    expect(svgs[0]!.svg).toContain('viewBox="76 56 348 248"');
    expect(shot.notes).toEqual([
      expect.stringContaining('Cropped to the comment frame springs ("SPRINGS")'),
      expect.stringContaining("Drawn from the document the way the patch editor lays it out"),
    ]);
  });

  it("draws an off-screen graph in the theme the editor shows", async () => {
    const { w, host, svgs, motion } = await withComponents();
    await host.screenshot({ kind: "graph" }, { component: motion });
    expect(svgs[0]!.svg).toContain('fill="#131315"');
    // The editor reports the light theme with its selection.
    w.server.handle("selection.get", () => ({ component: "main", componentPath: ["main"], layers: [], patches: [], comments: [], theme: "light" }));
    await host.screenshot({ kind: "graph" }, { component: motion });
    expect(svgs[1]!.svg).toContain('fill="#EFEFF2"');
    expect(svgs[1]!.svg).not.toContain('fill="#131315"');
  });

  it("draws a layer component's canvas and a layer inside it at frame 0", async () => {
    const { host, scenes, button } = await withComponents();
    const canvas = await host.screenshot({ kind: "canvas" }, { component: button, scale: 2 });
    expect(canvas).toMatchObject({ width: 240, height: 80, notes: [expect.stringContaining("Badge Button on its own 120×40 artboard at frame 0")] });
    expect(canvas.timeMs).toBeUndefined();
    expect(scenes[0]).toMatchObject({ crop: { x: 0, y: 0, width: 120, height: 40 } });
    expect(scenes[0]!.scene.size).toEqual([120, 40]);
    const badge = await host.screenshot({ kind: "layer", layerId: "badge" }, { component: button });
    expect(badge).toMatchObject({ width: 120, height: 40 });
  });

  it("draws the shown graph from the document when the patch editor panel is hidden, and teaches without a renderer", async () => {
    const { host, svgs } = await withComponents();
    const shot = await host.screenshot({ kind: "graph" }, {});
    expect(svgs[0]!.svg).toContain('data-node="press_next"');
    expect(shot.notes).toEqual([expect.stringContaining("The patch editor isn't showing Main")]);
    const bare = await withComponents({ renderSvg: undefined as never });
    expect(await rejection(bare.host.screenshot({ kind: "graph" }, { component: bare.motion }))).toMatchObject({ code: "target_unavailable", hint: expect.stringContaining("focus: true") });
  });
});

describe("app host simulations", () => {
  it("runs deterministic simulations of the live document and hot-swaps edits", async () => {
    const w = editorWindow(1);
    const host = appHost([w]);
    const reset = await host.sim.reset({ seed: 7 });
    expect(reset).toMatchObject({ docId: "photo_zoom", frame: expect.any(Number), seed: 7 });
    expect(host.sim.list()).toHaveLength(1);

    const dispatched = await host.sim.dispatch(reset.simId, [{ kind: "tap", target: "@card" }]);
    expect(dispatched.events[0]).toMatchObject({ kind: "tap", hit: { handledBy: expect.arrayContaining(["tap_photo"]) } });
    const settled = await host.sim.step(reset.simId, { until: "idle", maxMs: 4000 });
    expect(settled).toMatchObject({ settled: true, timedOut: false });
    const values = await host.sim.values(reset.simId, ["zoomed.on", "@photo.scale"]);
    expect(values.values["zoomed.on"]).toBe(true);
    expect(values.values["@photo.scale"]).toBeCloseTo(1.18, 2);

    await host.apply([{ op: "setInput", target: "photo_scale.end", value: 1.5 }], { label: "bigger zoom", author: CLAUDE });
    const swapped = await host.sim.step(reset.simId, { until: "idle", maxMs: 4000 });
    expect(swapped.documentUpdated).toBe(true);
    expect((await host.sim.values(reset.simId, ["@photo.scale"])).values["@photo.scale"]).toBeCloseTo(1.5, 2);

    const trace = await host.sim.trace(reset.simId, { targets: ["zoom_spring.output"], durationMs: 500, events: [{ kind: "tap", target: "@card" }] });
    expect(trace.times.length).toBeGreaterThan(20);
  });

  it("drops simulations whose window closed", async () => {
    const w = editorWindow(1);
    const windows = [w];
    const host = appHost(windows);
    const { simId } = await host.sim.reset({});
    windows.pop();
    host.forgetTarget(1);
    expect(host.sim.list()).toEqual([]);
    expect(await rejection(host.sim.values(simId, ["zoomed.on"]))).toMatchObject({ code: "unknown_sim" });
  });
});

describe("desktop MCP endpoint", () => {
  let server: McpServerHandle | null = null;
  let handler: NodeMcpHandler | null = null;

  afterEach(async () => {
    await handler?.close();
    await server?.close();
    handler = null;
    server = null;
  });

  it("serves the tools over Streamable HTTP with the bearer token", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sonobe-desktop-mcp-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const w = editorWindow(1);
    const host = appHost([w]);
    server = await startMcpServer({ version: "0.1.0-test", configDir: dir, port: 0 });
    handler = createHttpHandler(host, { version: "0.1.0-test" });
    server.setHandler(handler);

    const client = new Client({ name: "claude-code", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: { Authorization: `Bearer ${server.token}` } } });
    await client.connect(transport);
    cleanups.push(() => client.close());

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());

    const info = await client.callTool({ name: "get_document_info", arguments: {} });
    expect(JSON.stringify(info.content)).toContain("Photo Zoom");
    expect(info.structuredContent).toMatchObject({ docId: "photo_zoom", host: { kind: "app", screenshots: true } });

    const added = await client.callTool({
      name: "add_patches",
      arguments: {
        label: "added press feedback",
        patches: pressChain.filter((op) => op.op === "addPatch").map((op) => (op as Extract<Op, { op: "addPatch" }>).patch),
        connections: pressChain.filter((op) => op.op === "connect").map((op) => ({ from: (op as Extract<Op, { op: "connect" }>).from, to: (op as Extract<Op, { op: "connect" }>).to })),
      },
    });
    expect(added.isError).toBeFalsy();
    expect(added.structuredContent).toMatchObject({ ok: true, revision: 1 });
    expect(w.session.document.getState().historyEntries()[0]!.description).toBe("Claude: added press feedback (8 ops)");

    const history = await client.callTool({ name: "list_history", arguments: {} });
    expect(JSON.stringify(history.content)).toContain("Claude: added press feedback");

    const reset = await client.callTool({ name: "sim_reset", arguments: {} });
    const simId = (reset.structuredContent as { simId: string }).simId;
    await client.callTool({ name: "sim_dispatch", arguments: { simId, events: [{ kind: "tap", target: "@next_card" }] } });
    await client.callTool({ name: "sim_step", arguments: { simId, until: "idle" } });
    const values = await client.callTool({ name: "sim_get_values", arguments: { simId, targets: ["next_pressed.on"] } });
    expect(values.structuredContent).toMatchObject({ values: { "next_pressed.on": true } });

    const restarted = await client.callTool({ name: "restart_viewer", arguments: {} });
    expect(restarted.isError).toBeFalsy();
    expect(restarted.structuredContent).toMatchObject({ docId: "photo_zoom", playing: false, text: expect.stringContaining("Restarted the live prototype (paused on its first frame") });

    const noViewer = await client.callTool({ name: "get_screenshot", arguments: {} });
    expect(noViewer.isError).toBe(true);
    expect(JSON.stringify(noViewer.content)).toContain("no_viewer");

    const outline = await client.callTool({ name: "get_outline", arguments: { docId: "missing_doc" } });
    expect(outline.isError).toBe(true);
    expect(JSON.stringify(outline.content)).toContain("unknown_document");
    w.server.handle("viewer.bounds", () => ({ x: 0, y: 0, width: 402, height: 874, stage: { x: 0, y: 0, width: 402, height: 874 }, scale: 1, devicePixelRatio: 1, prototypeSize: [402, 874] }));
    const shot = await client.callTool({ name: "get_screenshot", arguments: {} });
    expect(shot.content).toMatchObject([{ type: "image", mimeType: "image/png" }, { type: "text" }]);
  });

  it("lists and recovers the draft a window left behind, and creates projects it doesn't open", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sonobe-desktop-mcp-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const storage = createMemoryProjectStorage();
    const drafts = createMemoryProjectStorage();
    // A window works on an Untitled prototype and goes away without saving (a crash, a killed process).
    const lost = editorWindow(1, { storage, drafts });
    lost.session.document.getState().newDocument();
    lost.session.document.getState().apply([{ op: "addLayer", layer: { id: "hero", type: "rectangle", name: "An hour of work" } }], { label: "Add Hero" });
    lost.session.document.getState().apply([{ op: "removeLayer", id: "hero" }], { label: "Remove Hero" });
    lost.session.document.getState().apply([{ op: "addLayer", layer: { type: "rectangle", name: "An hour of work" } }], { label: "Add Hero again" });
    await lost.session.drafts!.flush();
    const draftId = lost.session.drafts!.current()!.id;

    const w = editorWindow(2, { storage, drafts });
    const host = appHost([w], { drafts: { list: () => w.session.host!.drafts!.list() } });
    server = await startMcpServer({ version: "0.1.0-test", configDir: dir, port: 0 });
    handler = createHttpHandler(host, { version: "0.1.0-test" });
    server.setHandler(handler);
    const client = new Client({ name: "claude-code", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: { Authorization: `Bearer ${server.token}` } } }));
    cleanups.push(() => client.close());
    const text = (r: unknown) => (((r as { content?: unknown }).content ?? []) as { type: string; text?: string }[]).map((c) => c.text ?? "").join("\n");

    const listed = await client.callTool({ name: "list_documents", arguments: {} });
    expect(text(listed)).toContain(`draft:${draftId} "Untitled" · never saved · just now · 1 layer`);
    expect(listed.structuredContent).toMatchObject({ drafts: [{ id: draftId, name: "Untitled", counts: { layers: 1 } }] });

    const opened = await client.callTool({ name: "open_document", arguments: { ref: `draft:${draftId}` } });
    expect(opened.isError).toBeFalsy();
    expect(text(opened)).toContain("Recovered the draft");
    expect(text(opened)).toContain("kept as a draft");
    const s = w.session.document.getState();
    expect(s).toMatchObject({ dirty: true, projectPath: null });
    expect(s.doc.components.main!.layers.map((l) => l.name)).toEqual(["An hour of work"]);
    // The draft continues its session: "hero" was removed there, so it stays retired.
    expect(s.retiredIds()).toMatchObject({ main: ["hero"] });
    expect(s.isRetiredId("main", "hero")).toBe(true);
    // It's this window's draft now, so nothing is left to recover.
    expect(await host.listDrafts!()).toEqual([]);
    // A draft that isn't there fails before anyone is asked about unsaved changes.
    await expect(host.openDocument("draft:nope-nope-nope")).rejects.toMatchObject({ code: "unknown_draft", hint: expect.stringContaining("list_documents") });

    const created = await client.callTool({ name: "create_document", arguments: { name: "Later", open: false } });
    expect(created.isError).toBeFalsy();
    expect(text(created)).toContain(`Created /Users/test/Documents/Later.sonobe. It isn't open; call open_document({ ref: "/Users/test/Documents/Later.sonobe" })`);
    expect(created.structuredContent).toMatchObject({ docId: "later", open: false });
  });
});

describe("app host and the in-app Assistant", () => {
  it("tells the Assistant which document a window shows", async () => {
    const a = editorWindow(1);
    const b = editorWindow(2);
    const windows = [a, b];
    const host = appHost(windows);
    expect(await host.targetDocument(2)).toEqual({ docId: "photo_zoom", projectPath: null });
    expect(await host.targetDocument(1)).toEqual({ docId: "photo_zoom_2", projectPath: null });
    expect(await host.targetDocument(3)).toBeNull();
    windows.pop();
    expect(await host.targetDocument(2)).toBeNull();
  });

  it("keeps a reply's edits in the window that sent it when the person focuses another window", async () => {
    const a = editorWindow(1);
    const b = editorWindow(2);
    const windows = [a, b];
    const host = appHost(windows);
    const bridge = createMcpToolBridge({ host, version: "0.1.0-test" });
    cleanups.push(() => bridge.close());
    const api = scriptedClient([
      { content: [{ type: "tool_use", id: "t1", name: "rename", input: { updates: [{ id: "photo", name: "Hero Photo" }] } }] },
      { content: [{ type: "tool_use", id: "t2", name: "rename", input: { updates: [{ id: "card", name: "Hero Card" }] } }] },
      { content: [{ type: "text", text: "Renamed both." }] },
    ]);
    const agent = createAssistantAgent({ tools: () => bridge, apiKey: async () => "sk-ant-test-key-1234", createClient: () => api.client, documentFor: (id) => host.targetDocument(Number(id)) });
    const result = await agent.run("1", { text: "Rename the photo and the card" }, (event) => {
      // Focus flips to window 2 (the focused window comes first) after the first edit.
      if (event.type === "tool_finished" && event.toolUseId === "t1") windows.reverse();
    });

    expect(result.outcome).toBe("completed");
    const names = (w: TestWindow) => ["photo", "card"].map((id) => findLayer(w.session.document.getState().doc.components.main!.layers, id)?.layer.name);
    expect(names(a)).toEqual(["Hero Photo", "Hero Card"]);
    expect(names(b)).toEqual(["Photo", "Event Card"]);
    // A call without docId from anywhere else goes to the window in front, which is window 2 now.
    expect((await bridge.call("rename", { updates: [{ id: "photo", name: "Front Photo" }] })).isError).toBeFalsy();
    expect(names(b)).toEqual(["Front Photo", "Event Card"]);
  });
});
