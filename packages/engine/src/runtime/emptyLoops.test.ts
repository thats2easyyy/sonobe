import { applyOps, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { buildDoc, createMockRegistry, createTestRuntime, defineMock, port, runFrames, type ComponentInput } from "../testing/index.ts";
import type { RuntimeIssue } from "../types.ts";
import { EMPTY_LOOP_HINT } from "./emptyLoops.ts";

/** Loop Select in Skip mode, reduced: indices past the end are left out, and an empty result is explained. */
const pick = defineMock({
  type: "pick",
  name: "Pick",
  variants: ["number", "boolean"],
  inputs: [port("loop", "variant", { wholeLoop: true, default: { loop: [] } as never }), port("index", "number", { wholeLoop: true, default: 0 })],
  outputs: [port("output", "variant", { wholeLoop: true })],
  evaluate(ctx) {
    const items = ctx.inputItems("loop");
    const out = ctx.inputItems<number>("index").filter((i) => i >= 0 && i < items.length).map((i) => items[i]!);
    ctx.output("output", out as never);
    if (!out.length && items.length) ctx.explainEmpty?.(`every index is past the end of its ${items.length}-item Loop.`, [{ input: "index", value: 0, description: "Set Index to 0" }]);
  },
});
const reg = createMockRegistry([pick]);
const emptyLoops = (issues: RuntimeIssue[]) => issues.filter((i) => i.code === "empty_loop");

/** Dots at three positions whose opacity comes from Pick, which picks past the end of its 2-item loop. */
const dots = (index: unknown = { loop: [2, 3] }) =>
  buildDoc(
    {
      layers: [{ id: "dot", type: "rectangle", name: "Dot", props: { position: { link: "pos.output" }, size: [20, 20], opacity: { link: "fade.output" } } }],
      patches: {
        pos: { type: "splitter", typeParam: "point", inputs: { value: { loop: [[0, 0], [0, 50], [0, 100]] } } },
        picked: { type: "pick", name: "Picked", inputs: { loop: { loop: [1, 0.5] }, index: index as never } },
        fade: { type: "splitter", inputs: { value: { link: "picked.output" } } },
      },
    },
    reg,
  );

const apply = (doc: SonobeDocument, ops: unknown[]) => {
  const result = applyOps(doc, ops as never, { registry: reg });
  if (!result.doc) throw new Error(JSON.stringify(result.results));
  return result.doc;
};

describe("empty_loop warnings", () => {
  it("says which layer has 0 copies, where the empty loop started and what it erased, with a hint and ready fixes", () => {
    const rt = createTestRuntime(dots(), reg);
    rt.step();
    expect(rt.scene().roots).toEqual([]);
    const [issue, ...rest] = emptyLoops(rt.issues());
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({ code: "empty_loop", severity: "warning", layerId: "dot", hint: EMPTY_LOOP_HINT });
    expect(issue!.message).toBe(
      'Layer "Dot" has 0 copies because "Picked" (Pick) returned an empty loop: every index is past the end of its 2-item Loop. The empty loop reached Layer "Dot" on Opacity and erased the 3 items on its other properties.',
    );
    expect(issue!.hint).toContain("safe start value (Or with false, Max with 0) doesn't help");
    expect(issue!.suggestions).toEqual([{ description: 'Set Index to 0. It changes "Picked" (Pick).', ops: [{ op: "setInput", component: "main", target: "picked.index", value: 0 }] }]);
    // The suggestion is ready to apply.
    rt.updateDocument(apply(rt.document, issue!.suggestions![0]!.ops!));
    runFrames(rt, 2);
    expect(rt.scene().roots.map((n) => n.key)).toEqual(["dot#0", "dot#1", "dot#2"]);
    expect(emptyLoops(rt.issues())).toEqual([]);
  });

  it("stays quiet for a list that is simply empty", () => {
    const rt = createTestRuntime(
      buildDoc({ layers: [{ id: "row", type: "rectangle", name: "Row", props: { position: { link: "pos.output" } } }], patches: { pos: { type: "splitter", typeParam: "point", inputs: { value: { loop: [] } } } } }, reg),
      reg,
    );
    runFrames(rt, 3);
    expect(emptyLoops(rt.issues())).toEqual([]);
  });

  it("goes away as soon as the layer has copies again, and an edit clears it until it's true again", () => {
    const rt = createTestRuntime(dots(), reg);
    rt.step();
    expect(emptyLoops(rt.issues())).toHaveLength(1);
    // An unrelated edit: the warning clears, then comes back after two frames (one frame alone may be a list on its way to empty).
    rt.updateDocument(apply(rt.document, [{ op: "rename", id: "fade", name: "Fade" }]));
    expect(emptyLoops(rt.issues())).toEqual([]);
    rt.step();
    expect(emptyLoops(rt.issues())).toEqual([]);
    rt.step();
    expect(emptyLoops(rt.issues())).toHaveLength(1);
    // A literal edit that fixes it.
    rt.updateDocument(apply(rt.document, [{ op: "setInput", target: "picked.index", value: { loop: [0, 1, 1] } }]));
    rt.step();
    expect(rt.scene().roots).toHaveLength(3);
    expect(emptyLoops(rt.issues())).toEqual([]);
  });

  it("reports a component with 0 copies once, however many hosts show it, and restart clears it", () => {
    const echo: ComponentInput = {
      id: "echo",
      kind: "patchComponent",
      inputs: { v: { type: "number", default: 0 }, at: { type: "point", default: [0, 0] } },
      outputs: { out: { type: "number", link: "s.output" } },
      patches: { s: { type: "splitter", inputs: { value: { link: "$in.v" } } } },
    };
    const doc = buildDoc(
      {
        components: [echo],
        patches: {
          pos: { type: "splitter", typeParam: "point", inputs: { value: { loop: [[0, 0], [0, 50]] } } },
          picked: { type: "pick", inputs: { loop: { loop: [1] }, index: 4 } },
          inst: { type: "component", component: "echo", name: "Echo", inputs: { v: { link: "picked.output" }, at: { link: "pos.output" } } },
        },
      },
      reg,
    );
    const rt = createTestRuntime(doc, reg);
    runFrames(rt, 3);
    const [issue, ...rest] = emptyLoops(rt.issues());
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({ patchId: "inst" });
    expect(issue!.message).toBe(
      '"Echo" (Component) has 0 copies because "Pick" returned an empty loop: every index is past the end of its 1-item Loop. The empty loop reached "Echo" (Component) on v and erased the 2 items on its other inputs.',
    );
    rt.restart();
    expect(emptyLoops(rt.issues())).toEqual([]);
  });

  it("gives every runtime context explainEmpty", () => {
    let seen: unknown;
    const probe = defineMock({
      type: "probeContext",
      name: "Probe Context",
      inputs: [],
      outputs: [],
      evaluate(ctx) {
        seen = typeof ctx.explainEmpty;
      },
    });
    const r = createMockRegistry([probe]);
    createTestRuntime(buildDoc({ patches: { p: { type: "probeContext" } } }, r), r).step();
    expect(seen).toBe("function");
  });
});

describe("inspect", () => {
  it("explains a layer that drew 0 copies, with its warning", () => {
    const rt = createTestRuntime(dots(), reg);
    rt.step();
    const seen = rt.inspect("@dot.size");
    expect(seen.value).toEqual([20, 20]);
    expect(seen.copies).toBe(0);
    expect(seen.note).toBe(`Not drawn: ${emptyLoops(rt.issues())[0]!.message}`);
  });

  it("explains a layer with 0 copies even when nothing warned about it", () => {
    const rt = createTestRuntime(
      buildDoc({ layers: [{ id: "row", type: "rectangle", name: "Row", props: { position: { link: "pos.output" } } }], patches: { pos: { type: "splitter", typeParam: "point", inputs: { value: { loop: [] } } } } }, reg),
      reg,
    );
    rt.step();
    expect(rt.inspect("@row.position")).toEqual({ value: undefined, copies: 0, note: 'Not drawn: Layer "Row" has 0 copies because its Position comes from "Splitter", whose Value is set to an empty loop.' });
  });

  it("says when #n is past the end of a layer's copies or of a loop", () => {
    const rt = createTestRuntime(dots({ loop: [0, 1, 1] }), reg);
    rt.step();
    expect(rt.inspect("@dot.opacity#1")).toEqual({ value: 0.5, copies: 3 });
    expect(rt.inspect("@dot.opacity#5")).toEqual({ value: undefined, copies: 3, note: 'Layer "Dot" has 3 copies (#0 to #2), so there\'s no #5.' });
    expect(rt.inspect("pos.output#7").note).toBe("It's a loop of 3 items (#0 to #2), so there's no #7.");
    expect(rt.inspect("pos.output#2")).toEqual({ value: [0, 100] });
  });

  it("explains an empty loop value back to where it started", () => {
    const rt = createTestRuntime(dots(), reg);
    rt.step();
    expect(rt.inspect("fade.output")).toEqual({ value: undefined, note: 'It\'s an empty loop because "Picked" (Pick) returned an empty loop: every index is past the end of its 2-item Loop.' });
    expect(rt.inspect("fade.value").note).toBe(rt.inspect("fade.output").note);
  });

  it("explains an instance path that runs into a component with 0 copies, or past its last copy", () => {
    const echo: ComponentInput = {
      id: "echo",
      kind: "patchComponent",
      inputs: { v: { type: "number", default: 0 } },
      outputs: { out: { type: "number", link: "s.output" } },
      patches: { s: { type: "splitter", inputs: { value: { link: "$in.v" } } } },
    };
    const doc = (index: number) =>
      buildDoc({ components: [echo], patches: { picked: { type: "pick", inputs: { loop: { loop: [1, 2] }, index: { loop: [index, 1] } } }, inst: { type: "component", component: "echo", name: "Echo", inputs: { v: { link: "picked.output" } } } } }, reg);
    const rt = createTestRuntime(doc(0), reg);
    rt.step();
    expect(rt.inspect("inst#1/s.output")).toEqual({ value: 2 });
    expect(rt.inspect("inst#4/s.output")).toEqual({ value: undefined, note: '"Echo" (Component) has 2 copies (#0 to #1), so there\'s no #4 to read inside.' });
    const empty = createTestRuntime(
      buildDoc({ components: [echo], patches: { picked: { type: "pick", inputs: { loop: { loop: [1, 2] }, index: 5 } }, inst: { type: "component", component: "echo", name: "Echo", inputs: { v: { link: "picked.output" } } } } }, reg),
      reg,
    );
    empty.step();
    expect(empty.inspect("inst/s.output").note).toBe('Nothing to read: "Echo" (Component) has 0 copies because "Pick" returned an empty loop: every index is past the end of its 2-item Loop.');
  });
});
