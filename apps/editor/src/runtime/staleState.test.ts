import { applyOps, type Op, type SonobeDocument } from "@sonobe/core";
import { createRuntime } from "@sonobe/engine";
import { buildDoc, createMockRegistry, defineMock, port, runFrames } from "@sonobe/engine/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createDocumentStore } from "../state/document.ts";
import { createRuntimeHost, type RuntimeHost } from "./runtimeHost.ts";
import { createManualScheduler } from "./scheduler.ts";
import { freshStartDraws, staleStateDiagnostic, stillStale } from "./staleState.ts";

/** Loop Select in Skip mode, reduced: indices past the end are left out. */
const pick = defineMock({
  type: "pick",
  name: "Pick",
  inputs: [port("loop", "number", { wholeLoop: true, default: { loop: [] } as never }), port("index", "number", { wholeLoop: true, default: 0 })],
  outputs: [port("output", "number", { wholeLoop: true })],
  evaluate(ctx) {
    const items = ctx.inputItems<number>("loop");
    ctx.output("output", ctx.inputItems<number>("index").filter((i) => i >= 0 && i < items.length).map((i) => items[i]!) as never);
  },
});

/** State that goes bad on frame 3 and stays bad: indices 0 and 1, then only 5 (past the end). */
const latch = defineMock<{ tripped: boolean }>({
  type: "latch",
  name: "Latch",
  category: "state",
  inputs: [],
  outputs: [port("index", "number", { wholeLoop: true })],
  state: () => ({ tripped: false }),
  evaluate(ctx) {
    if (ctx.frame >= 3) ctx.state.tripped = true;
    ctx.output("index", (ctx.state.tripped ? [5] : [0, 1]) as never);
  },
});

const registry = createMockRegistry([pick, latch]);

/** Dots at three positions whose opacity Pick picks; its index comes from Latch, or is fixed. */
const dots = (index: unknown = { link: "latch.index" }) =>
  buildDoc(
    {
      layers: [{ id: "dot", type: "rectangle", name: "Dot", props: { position: { link: "pos.output" }, size: [20, 20], opacity: { link: "fade.output" } } }],
      patches: {
        pos: { type: "splitter", typeParam: "point", inputs: { value: { loop: [[0, 0], [0, 50], [0, 100]] } } },
        latch: { type: "latch" },
        picked: { type: "pick", name: "Picked", inputs: { loop: { loop: [1, 0.5] }, index: index as never } },
        fade: { type: "splitter", inputs: { value: { link: "picked.output" } } },
      },
    },
    registry,
  );

const edit = (doc: SonobeDocument, ops: Op[]) => {
  const result = applyOps(doc, ops, { registry });
  if (!result.doc) throw new Error(JSON.stringify(result.results));
  return result.doc;
};

describe("freshStartDraws", () => {
  it("finds a layer the live prototype lost to old state but a fresh start draws", () => {
    const doc = dots();
    const live = createRuntime(doc, { registry, platform: {}, deterministic: true });
    runFrames(live, 6);
    expect(live.scene().roots).toEqual([]);
    const issues = live.issues();
    expect(issues).toEqual([expect.objectContaining({ code: "empty_loop", layerId: "dot" })]);
    const stale = freshStartDraws(doc, issues, { registry });
    expect(stale).toEqual({ layerId: "dot", copies: 3 });
    expect(stillStale(stale!, issues)).toBe(true);
    expect(stillStale(stale!, [])).toBe(false);
    expect(staleStateDiagnostic(stale!, doc)).toMatchObject({ code: "stale_state", severity: "info", component: "main", itemIds: ["dot"], message: expect.stringContaining('Layer "Dot"') });
    live.dispose();
  });

  it("stays quiet when the wiring empties the loop from the start, or nothing is empty", () => {
    const doc = dots({ loop: [2, 3] });
    const live = createRuntime(doc, { registry, platform: {}, deterministic: true });
    runFrames(live, 3);
    expect(live.issues()).toHaveLength(1);
    expect(freshStartDraws(doc, live.issues(), { registry })).toBeNull();
    expect(freshStartDraws(doc, [], { registry })).toBeNull();
    live.dispose();
  });
});

describe("the viewer's restart offer", () => {
  const hosts: RuntimeHost[] = [];
  afterEach(() => {
    for (const host of hosts.splice(0)) host.dispose();
  });

  function setup(doc: SonobeDocument) {
    const scheduler = createManualScheduler();
    const store = createDocumentStore({ registry, document: doc });
    const host = createRuntimeHost({ registry, document: store, scheduler, textMeasurer: "approximate", platform: null, statsIntervalMs: 0 });
    hosts.push(host);
    return { scheduler, store, host };
  }

  it("offers Restart after an edit that leaves state from before it, and a restart clears it", () => {
    const { scheduler, store, host } = setup(dots());
    scheduler.frames(8);
    expect(host.state.getState().diagnostics).toEqual([expect.objectContaining({ code: "empty_loop" })]);
    expect(host.state.getState().staleState).toBeNull();

    // An edit while the warning is up; the latch stays tripped, so the dots stay gone.
    store.getState().apply([{ op: "rename", id: "fade", name: "Fade" }], { label: "Rename" });
    scheduler.frames(2);
    expect(host.state.getState().staleState).toBeNull();
    scheduler.frames(20);
    expect(host.state.getState().staleState).toEqual({ layerId: "dot", copies: 3 });

    const restarts: number[] = [];
    host.subscribeRestart(() => restarts.push(host.runtime.frame));
    host.restart();
    expect(restarts).toHaveLength(1);
    scheduler.frame();
    expect(host.state.getState().staleState).toBeNull();
    expect(host.scene()!.roots.map((n) => n.key)).toEqual(["dot#0", "dot#1", "dot#2"]);
  });

  it("doesn't offer it for wiring that empties the loop, or for edits made without a warning", () => {
    const fixed = setup(dots({ loop: [2, 3] }));
    fixed.scheduler.frames(4);
    fixed.store.getState().apply([{ op: "rename", id: "fade", name: "Fade" }], { label: "Rename" });
    fixed.scheduler.frames(30);
    expect(fixed.host.state.getState().diagnostics).toEqual([expect.objectContaining({ code: "empty_loop" })]);
    expect(fixed.host.state.getState().staleState).toBeNull();

    // Before the latch trips there's no warning, so an edit then runs no fresh copy.
    const early = setup(dots());
    early.scheduler.frames(1);
    early.store.getState().apply([{ op: "rename", id: "fade", name: "Fade" }], { label: "Rename" });
    early.scheduler.frames(30);
    expect(early.host.state.getState().diagnostics).toEqual([expect.objectContaining({ code: "empty_loop" })]);
    expect(early.host.state.getState().staleState).toBeNull();
  });

  it("drops the offer once an edit brings the copies back", () => {
    const { scheduler, store, host } = setup(dots());
    scheduler.frames(8);
    store.getState().apply([{ op: "rename", id: "fade", name: "Fade" }], { label: "Rename" });
    scheduler.frames(30);
    expect(host.state.getState().staleState).not.toBeNull();
    store.getState().apply([{ op: "setInput", target: "picked.index", value: { loop: [0, 1] } }], { label: "Fix" });
    scheduler.frames(30);
    expect(host.scene()!.roots).toHaveLength(3);
    expect(host.state.getState().staleState).toBeNull();
  });

  it("uses the edited document for the fresh copy", () => {
    const doc = edit(dots(), [{ op: "rename", id: "dot", name: "Card" }]);
    expect(staleStateDiagnostic({ layerId: "dot", copies: 1 }, doc).message).toContain('Layer "Card", but started fresh the same document draws 1 copy.');
  });
});
