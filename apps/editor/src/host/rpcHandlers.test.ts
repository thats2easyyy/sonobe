import { findLayer } from "@sonobe/core";
import type { InputEvent } from "@sonobe/engine";
import { buildDoc, MOCK_DEFINITIONS } from "@sonobe/engine/testing";
import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, describe, expect, it } from "vitest";
import { createManualScheduler } from "../runtime/scheduler.ts";
import { createEditorSession, type EditorSession } from "../state/session.ts";
import { createBrowserHost, createMemoryProjectStorage } from "./browserHost.ts";
import { registerRpcHandlers, RPC_METHODS } from "./rpcHandlers.ts";
import type { RpcRegistrar } from "./types.ts";

const registry = createPatchRegistry({ definitions: MOCK_DEFINITIONS });

interface Failure {
  failed: true;
  code: string;
  message: string;
  data?: unknown;
}

function fakeRpc() {
  const handlers = new Map<string, (params: unknown) => unknown>();
  const rpc: RpcRegistrar = {
    handle(method, fn) {
      handlers.set(method, fn);
      return () => handlers.delete(method);
    },
    methods: () => [...handlers.keys()],
    fail: (code, message, data): Failure => ({ failed: true, code, message, ...(data !== undefined ? { data } : {}) }),
  };
  const call = async <T = Record<string, unknown>>(method: string, params?: unknown): Promise<T> => {
    const fn = handlers.get(method);
    if (!fn) throw new Error(`no handler ${method}`);
    return (await fn(params)) as T;
  };
  return { rpc, handlers, call };
}

let session: EditorSession | null = null;
afterEach(() => {
  session?.dispose();
  session = null;
});

function setup(saveName: string | null = "Agent Proto", options: { drafts?: ReturnType<typeof createMemoryProjectStorage> } = {}) {
  const doc = buildDoc(
    {
      layers: [{ id: "card", type: "rectangle", props: { position: [0, 0], size: [390, 400] } }],
      patches: {
        tap: { type: "interaction", inputs: { layer: { layer: "card" } } },
        toggle: { type: "switch", inputs: { flip: { link: "tap.tap" } } },
        pop: { type: "popAnimation", inputs: { number: { link: "toggle.on" } } },
      },
    },
    registry,
  );
  const names = { save: saveName, asked: 0 };
  const host = createBrowserHost({
    storage: createMemoryProjectStorage(),
    ...(options.drafts ? { drafts: options.drafts, locks: null } : {}),
    channelName: null,
    recentKey: null,
    fileSystemAccess: false,
    dialogs: {
      promptName: async () => {
        names.asked++;
        return names.save;
      },
    },
  });
  session = createEditorSession({ host, registry, document: doc, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate", drafts: { debounceMs: 0, maxWaitMs: 0 } });
  const { rpc, handlers, call } = fakeRpc();
  const off = registerRpcHandlers(session, { rpc });
  return { session, handlers, call, off, names };
}

const down: InputEvent = { kind: "pointer", phase: "down", pointerId: 1, x: 100, y: 100 };
const up: InputEvent = { kind: "pointer", phase: "up", pointerId: 1, x: 100, y: 100 };

describe("rpc handlers", () => {
  it("registers every method and unregisters them", () => {
    const { handlers, off } = setup();
    expect([...handlers.keys()].sort()).toEqual([...RPC_METHODS].sort());
    off();
    expect(handlers.size).toBe(0);
  });

  it("describes and reads the document", async () => {
    const { call } = setup();
    expect(await call("document.info")).toMatchObject({ name: "Test", revision: 0, dirty: false, root: "main", currentComponent: "main", components: [{ id: "main", layerCount: 1, patchCount: 3 }] });
    expect(await call("document.get", { format: "outline", detail: "compact" })).toMatchObject({ outline: expect.stringContaining("patch toggle switch flip←tap.tap") });
    expect(await call("document.get", { component: "main" })).toMatchObject({ revision: 0, component: { id: "main" } });
    expect(Object.keys((await call<{ files: Record<string, string> }>("document.get", { format: "files" })).files)).toContain("components/main.json");
    expect(await call("document.get", { component: "nope" })).toMatchObject({ failed: true, code: "not_found" });
    expect(await call("document.get", "bad")).toMatchObject({ failed: true, code: "invalid_params" });
  });

  it("applies ops as the agent, with dry runs and revision checks", async () => {
    const { call, session: s } = setup();
    const ops = [{ op: "addLayer", layer: { id: "badge", type: "oval", name: "Badge" } }];
    const dry = await call("document.apply", { ops, label: "added badge", dryRun: true });
    expect(dry).toMatchObject({ result: { ok: true, affected: { layers: ["badge"] } }, revision: 0 });
    expect(findLayer(s.document.getState().doc.components.main!.layers, "badge")).toBeUndefined();

    const applied = await call("document.apply", { ops, label: "added badge", expectedRevision: 0 });
    expect(applied).toMatchObject({ result: { ok: true, idMap: {}, applied: 1 }, revision: 1, diagnostics: expect.any(Array) });
    expect(s.document.getState().historyEntries()[0]!.description).toBe("Claude: added badge");
    expect(s.presence.getState().recent[0]).toMatchObject({ kind: "apply", description: "Claude: added badge", ids: ["badge"] });

    const stale = await call("document.apply", { ops: [{ op: "removeLayer", id: "badge" }], expectedRevision: 0 });
    expect(stale).toMatchObject({ result: { ok: false, errors: [{ code: "revision_mismatch" }] }, revision: 1 });
    const broken = await call("document.apply", { ops: [{ op: "removeLayer", id: "ghost" }] });
    expect(broken).toMatchObject({ result: { ok: false, errors: [{ code: "not_found" }] } });
    expect(await call("document.apply", { ops: "nope" })).toMatchObject({ failed: true, code: "invalid_params" });
    expect(s.document.getState().lastChange?.source).toBeUndefined();

    expect(await call("history.list")).toMatchObject({ revision: 1, entries: [{ label: "added badge", author: { kind: "agent", name: "Claude" } }] });
    expect(await call("history.undo")).toMatchObject({ ok: true, revision: 2, undone: [{ label: "added badge" }] });
    expect(findLayer(s.document.getState().doc.components.main!.layers, "badge")).toBeUndefined();
    expect(await call("history.undo")).toMatchObject({ failed: true, code: "nothing_to_undo" });
  });

  it("records what made a batch, so import_design's lands as an import whatever its label", async () => {
    const { call, session: s } = setup();
    const ops = [{ op: "addLayer", layer: { id: "screen", type: "group", name: "Receipt", props: { size: [402, 874] } } }];
    expect(await call("document.apply", { ops, label: "set up the receipt", source: "import" })).toMatchObject({ result: { ok: true } });
    expect(s.document.getState().lastChange).toMatchObject({ kind: "apply", label: "set up the receipt", source: "import", author: { kind: "agent" } });
    expect(await call("document.apply", { ops: [], source: "paste" })).toMatchObject({ failed: true, code: "invalid_params", message: expect.stringContaining('"source" must be "import"') });
  });

  it("runs deterministic simulations", async () => {
    const { call } = setup();
    const reset = await call<{ simId: string; frame: number }>("sim.reset", { seed: 3 });
    expect(reset).toMatchObject({ frame: -1, seed: 3, revision: 0 });
    const simId = reset.simId;
    expect(await call("sim.dispatch", { simId, events: [down] })).toEqual({ simId, queued: 1 });
    const stepped = await call("sim.step", { simId, frames: 1, targets: ["tap.down"] });
    expect(stepped).toMatchObject({ frame: 0, values: { "tap.down": true } });
    expect(await call("sim.step", { simId, events: [[up], []], frames: 2, targets: ["toggle.on"] })).toMatchObject({ frame: 2, values: { "toggle.on": true } });
    expect(await call("sim.values", { simId, targets: ["toggle.on"] })).toMatchObject({ simId, frame: 2, values: { "toggle.on": true } });

    const trace = await call<{ times: number[]; summaries: Record<string, unknown> }>("sim.trace", { targets: ["pop.output"], durationMs: 800 });
    expect(trace.times.length).toBe(48);
    expect(trace.summaries["pop.output"]).toMatchObject({ end: expect.closeTo(1, 2) });

    expect(await call("sim.values", { simId: "sim_nope", targets: [] })).toMatchObject({ failed: true, code: "not_found" });
    expect(await call("sim.dispatch", { simId, events: [{ nope: true }] })).toMatchObject({ failed: true, code: "invalid_params" });
    expect(await call("sim.trace", { simId, targets: ["pop.output"], durationMs: 10 ** 9 })).toMatchObject({ failed: true, code: "invalid_params" });
    expect(await call("sim.reset", { simId })).toMatchObject({ simId, frame: -1 });
  });

  it("tracks presence, selection, and reveal", async () => {
    const { call, session: s } = setup();
    const { workId } = await call<{ workId: string }>("presence.begin", { ids: ["card"], intent: "adding a press animation" });
    expect(s.presence.getState().working).toMatchObject([{ workId, ids: ["card"], author: { kind: "agent", name: "Claude" } }]);
    expect(await call("presence.finish", { workId, summary: "done" })).toEqual({ finished: true });
    expect(s.presence.getState().recent[0]).toMatchObject({ kind: "finish", description: "Claude: done" });
    expect(await call("presence.begin", { ids: [] })).toMatchObject({ failed: true, code: "invalid_params" });

    expect(await call("reveal", { ids: ["card", "pop", "ghost"] })).toEqual({ component: "main", componentPath: ["main"], revealed: ["card", "pop"], missing: ["ghost"], focused: false, shown: "main", inView: true, opened: false });
    expect(s.selection.getState()).toMatchObject({ layers: [], patches: [], reveal: { component: "main", ids: ["card", "pop"] } });
    expect(await call("reveal", { ids: ["card", "pop"], focus: true })).toMatchObject({ revealed: ["card", "pop"], focused: true });
    expect(s.selection.getState()).toMatchObject({ layers: ["card"], patches: ["pop"], reveal: { component: "main", ids: ["card", "pop"] } });
    expect(await call("selection.get")).toMatchObject({ component: "main", componentPath: ["main"], layers: ["card"], patches: ["pop"], comments: [], theme: "dark" });
    expect(await call("viewer.bounds")).toMatchObject({ failed: true, code: "no_viewer" });
  });

  it("reveals inside another component only with focus, and says so", async () => {
    const { call, session: s } = setup();
    s.document.getState().apply([{ op: "createComponent", name: "Toggle Pop", patchIds: ["toggle", "pop"] }], { label: "Make component" });
    const inner = Object.values(s.document.getState().doc.components).find((c) => c.name === "Toggle Pop")!;
    s.selection.getState().select({ layers: ["card"] });
    const before = s.selection.getState().reveal;
    // Without focus the person stays where they are, and nothing is revealed where they can't see it.
    expect(await call("reveal", { ids: ["pop"] })).toMatchObject({ component: inner.id, revealed: ["pop"], shown: "main", inView: false, opened: false, focused: false });
    expect(s.selection.getState()).toMatchObject({ componentPath: ["main"], layers: ["card"] });
    expect(s.selection.getState().reveal).toBe(before);
    // With focus it opens the component, selects the patch and reveals it there.
    expect(await call("reveal", { ids: ["pop"], focus: true })).toMatchObject({ component: inner.id, shown: inner.id, inView: true, opened: true, focused: true });
    expect(s.selection.getState()).toMatchObject({ componentPath: ["main", inner.id], patches: ["pop"], reveal: { component: inner.id, ids: ["pop"] } });
  });

  it("saves (false when cancelled) and opens projects", async () => {
    const { call, session: s, names } = setup();
    names.save = null;
    expect(await call("document.save")).toBe(false);
    names.save = "Agent Proto";
    expect(await call("document.save")).toMatchObject({ ok: true, path: "browser:Agent Proto" });
    expect(s.document.getState().dirty).toBe(false);
    const opened = await call("document.open", { path: "browser:Agent Proto" });
    expect(opened).toMatchObject({ ok: true, name: "Test", projectPath: "browser:Agent Proto", dirty: false, canUndo: false });
    expect(await call("document.open", { path: "browser:Missing" })).toMatchObject({ failed: true, code: "open_failed" });
  });

  it("saves to a folder the host chose without the Save panel, and never opens it for noDialog", async () => {
    const { call, session: s, names } = setup();
    expect(await call("document.save", { noDialog: true })).toMatchObject({ failed: true, code: "path_needed", data: { hint: expect.stringContaining("path") } });
    const saved = await call<{ ok: boolean; path: string; written: string[] }>("document.save", { path: "browser:Deck", noDialog: true });
    expect(saved).toMatchObject({ ok: true, path: "browser:Deck", deleted: [] });
    expect(saved.written).toEqual(expect.arrayContaining(["project.json", "components/main.json"]));
    expect(s.document.getState()).toMatchObject({ projectPath: "browser:Deck", dirty: false });
    // Save As a saved project with a path goes to the new folder too.
    expect(await call("document.save", { path: "browser:Deck Copy", noDialog: true })).toMatchObject({ ok: true, path: "browser:Deck Copy" });
    expect(names.asked).toBe(0);
  });
});

describe("rpc handlers: drafts", () => {
  it("recovers a draft another window left, flushes the current one, and reports it in document.info", async () => {
    const drafts = createMemoryProjectStorage();
    // A first window edits and goes away without saving.
    const first = setup("Agent Proto", { drafts });
    first.session.document.getState().apply([{ op: "addLayer", layer: { id: "hero", type: "oval", name: "Hero" } }], { label: "Add Hero" });
    expect(await first.call("drafts.flush")).toMatchObject({ flushed: true, draft: { id: expect.any(String) } });
    const id = (await first.call<{ draft: { id: string } }>("document.info")).draft.id;
    first.session.dispose();
    session = null;

    const second = setup("Agent Proto", { drafts });
    expect(await second.call("document.info")).toMatchObject({ draft: null });
    expect(await second.call("document.recoverDraft", {})).toMatchObject({ failed: true, code: "invalid_params" });
    expect(await second.call("document.recoverDraft", { id: "nope-nope-nope" })).toMatchObject({ failed: true, code: "unknown_draft", data: { hint: expect.stringContaining("list_documents") } });
    const recovered = await second.call("document.recoverDraft", { id });
    expect(recovered).toMatchObject({ ok: true, dirty: true, projectPath: null, draft: { id }, components: [{ id: "main", layerCount: 2 }] });
    expect(findLayer(second.session.document.getState().doc.components.main!.layers, "hero")).toBeDefined();
    // Asking again for the draft that's open is fine.
    expect(await second.call("document.recoverDraft", { id })).toMatchObject({ ok: true });
  });
});

describe("rpc handlers: data safety", () => {
  it("checks the human-edit guard in the same step it undoes", async () => {
    const { call, session: s } = setup();
    await call("document.apply", { ops: [{ op: "addLayer", layer: { id: "badge", type: "oval", name: "Badge" } }], label: "added badge" });
    const agentTxn = s.document.getState().historyEntries()[0]!.txnId;
    s.document.getState().apply([{ op: "addLayer", layer: { id: "human", type: "rectangle", name: "Human" } }], { label: "Add Human" });

    expect(await call("history.undo")).toMatchObject({ failed: true, code: "human_edit", data: { hint: expect.stringContaining("txnId") } });
    expect(await call("history.undo", { txnId: agentTxn })).toMatchObject({ failed: true, code: "human_edit", data: { hint: expect.stringContaining("allowHumanEdits") } });
    expect(await call("history.undo", { txnId: "txn_nope" })).toMatchObject({ failed: true, code: "not_found" });
    expect(findLayer(s.document.getState().doc.components.main!.layers, "human")).toBeDefined();
    expect(s.document.getState().redoEntries()).toEqual([]);

    const both = await call("history.undo", { txnId: agentTxn, allowHumanEdits: true });
    expect(both).toMatchObject({ ok: true, undone: [{ label: "Add Human", author: { kind: "human" }, description: "You: Add Human", revision: expect.any(Number) }, { label: "added badge", description: "Claude: added badge" }] });
  });

  it("refuses to save over outside changes unless forced, and reports them in document.info", async () => {
    const { call, session: s } = setup();
    expect(await call("document.save")).toMatchObject({ ok: true });
    const store = s.document;
    store.getState().apply([{ op: "addLayer", layer: { type: "oval", name: "Mine" } }], { label: "Add Mine" });
    store.setState({ externalChange: { path: store.getState().projectPath!, paths: ["components/main.json"], document: store.getState().doc, detectedAt: 7 } });
    expect(await call("document.info")).toMatchObject({ dirty: true, externalChange: { paths: ["components/main.json"], detectedAt: 7 }, diskProblem: null });

    expect(await call("document.save")).toMatchObject({ failed: true, code: "disk_changed", data: { paths: ["components/main.json"], hint: expect.stringContaining("force: true") } });
    expect(store.getState().dirty).toBe(true);
    expect(await call("document.save", { force: true })).toMatchObject({ ok: true });
    expect(store.getState()).toMatchObject({ dirty: false, externalChange: null });
  });
});

describe("rpc handlers: bridge additions", () => {
  it("returns the transaction id and the applied ops", async () => {
    const { call, session: s } = setup();
    const reply = await call<{ txnId?: string; applied: { op: string; layer?: { id?: string } }[]; result: { applied: number } }>("document.apply", { ops: [{ op: "addLayer", layer: { type: "oval", name: "Badge" } }], label: "added badge" });
    expect(reply.result.applied).toBe(1);
    expect(reply.applied).toEqual([expect.objectContaining({ op: "addLayer", layer: expect.objectContaining({ id: "badge" }) })]);
    expect(reply.txnId).toBe(s.document.getState().historyEntries()[0]!.txnId);
    const dry = await call<{ txnId?: string }>("document.apply", { ops: [{ op: "removeLayer", id: "badge" }], dryRun: true });
    expect(dry.txnId).toBeUndefined();
    const failed = await call<{ txnId?: string; applied: unknown[] }>("document.apply", { ops: [{ op: "removeLayer", id: "ghost" }] });
    expect(failed).toMatchObject({ applied: [] });
    expect(failed.txnId).toBeUndefined();
  });

  it("lists presence and starts new documents", async () => {
    const { call, session: s } = setup();
    await call("presence.begin", { ids: ["card"], intent: "tidying the card" });
    expect(await call("presence.list")).toMatchObject({ working: [{ ids: ["card"], intent: "tidying the card", author: { kind: "agent", name: "Claude" } }], recent: [] });
    expect(await call("presence.list", { limit: "x" })).toMatchObject({ failed: true, code: "invalid_params" });

    expect(await call("document.new", { template: "poster" })).toMatchObject({ failed: true, code: "invalid_params" });
    expect(await call("document.new", { device: "toaster" })).toMatchObject({ failed: true, code: "invalid_params" });
    const created = await call("document.new", { name: "Checkout", device: "iphone-se" });
    expect(created).toMatchObject({ ok: true, name: "Checkout", projectPath: null, dirty: false, device: { preset: "iphone-se" }, scripts: { count: 0, required: false, trusted: true } });
    expect(s.document.getState().doc.components.main!.layers).toEqual([]);
  });

  it("exposes panel bounds only while a panel provides them", async () => {
    const { call, handlers, session: s, off } = setup();
    expect(handlers.has("canvas.bounds")).toBe(false);
    let rect: { x: number; y: number; width: number; height: number; scale?: number } | null = { x: 10, y: 20, width: 300, height: 200, scale: 1.5 };
    const unregister = s.bounds.register("canvas.bounds", () => rect);
    expect(handlers.has("canvas.bounds")).toBe(true);
    expect(await call("canvas.bounds")).toEqual({ x: 10, y: 20, width: 300, height: 200, scale: 1.5 });
    rect = null;
    expect(await call("canvas.bounds")).toMatchObject({ failed: true, code: "target_unavailable" });
    unregister();
    expect(handlers.has("canvas.bounds")).toBe(false);

    s.bounds.register("viewer.layerBounds", ({ layerId }) => (layerId === "card" ? { x: 0, y: 0, width: 50, height: 40 } : null));
    expect(await call("viewer.layerBounds", {})).toMatchObject({ failed: true, code: "invalid_params" });
    expect(await call("viewer.layerBounds", { layerId: "card" })).toEqual({ x: 0, y: 0, width: 50, height: 40 });
    expect(await call("viewer.layerBounds", { layerId: "ghost" })).toMatchObject({ failed: true, code: "target_unavailable" });
    off();
    expect(handlers.size).toBe(0);
  });

  it("exposes graph.geometry only while a patch editor provides it", async () => {
    const { call, handlers, session: s, off } = setup();
    expect(handlers.has("graph.geometry")).toBe(false);
    const asked: unknown[] = [];
    const unregister = s.graphGeometry.register((params) => {
      asked.push(params);
      return { component: params.component ?? "main", shownComponent: "main", revision: 3, nodes: [["pop", 40, 60, 212, 124, 1]] };
    });
    expect(handlers.has("graph.geometry")).toBe(true);
    expect(await call("graph.geometry", { component: "main" })).toEqual({ component: "main", shownComponent: "main", revision: 3, nodes: [["pop", 40, 60, 212, 124, 1]] });
    expect(await call("graph.geometry")).toMatchObject({ component: "main" });
    expect(asked).toEqual([{ component: "main" }, {}]);
    unregister();
    expect(handlers.has("graph.geometry")).toBe(false);
    s.graphGeometry.register(() => null);
    expect(await call("graph.geometry", {})).toMatchObject({ failed: true, code: "target_unavailable" });
    off();
    expect(handlers.size).toBe(0);
  });
});

describe("assets.put", () => {
  it("holds asset files for addAsset ops and refuses bad names or data", async () => {
    const { call, session: s } = setup();
    expect(await call("assets.put", { files: [{ file: "abc123.png", mime: "image/png", data: "iVBORw0KGgo=" }] })).toEqual({ stored: 1 });
    expect(new Uint8Array(s.assets.peekBytes("abc123.png")!)[1]).toBe(0x50);
    expect(await call("assets.put", { files: [{ file: "../escape.png", data: "AAAA" }] })).toMatchObject({ failed: true, code: "invalid_params", message: expect.stringContaining("plain file name") });
    expect(await call("assets.put", {})).toMatchObject({ failed: true, message: expect.stringContaining('"files" is required') });
  });
});

