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

function setup(saveName: string | null = "Agent Proto") {
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
  const names = { save: saveName };
  const host = createBrowserHost({ storage: createMemoryProjectStorage(), channelName: null, recentKey: null, fileSystemAccess: false, dialogs: { promptName: async () => names.save } });
  session = createEditorSession({ host, registry, document: doc, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
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

    expect(await call("history.list")).toMatchObject({ revision: 1, entries: [{ label: "added badge", author: { kind: "agent", name: "Claude" } }] });
    expect(await call("history.undo")).toMatchObject({ ok: true, revision: 2, undone: [{ label: "added badge" }] });
    expect(findLayer(s.document.getState().doc.components.main!.layers, "badge")).toBeUndefined();
    expect(await call("history.undo")).toMatchObject({ failed: true, code: "nothing_to_undo" });
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

    expect(await call("reveal", { ids: ["card", "pop", "ghost"] })).toEqual({ component: "main", componentPath: ["main"], revealed: ["card", "pop"], missing: ["ghost"] });
    expect(s.selection.getState()).toMatchObject({ layers: ["card"], patches: ["pop"], reveal: { component: "main", ids: ["card", "pop"] } });
    expect(await call("selection.get")).toMatchObject({ component: "main", componentPath: ["main"], layers: ["card"], patches: ["pop"], comments: [] });
    expect(await call("viewer.bounds")).toMatchObject({ failed: true, code: "no_viewer" });
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
});
