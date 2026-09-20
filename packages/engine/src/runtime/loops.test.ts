import type { SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { buildDoc, createMockRegistry, createTestRuntime, defineMock, port, probeDefinition, runFrames, sequenceDefinition, tap, type ComponentInput } from "../testing/index.ts";
import { compileDocument } from "./compile.ts";
import { isLoop, makeLoop } from "./loop.ts";

const items = (v: unknown) => (isLoop(v) ? v.items : v);

describe("loops: evaluation", () => {
  it("output length is the longest loop and shorter loops wrap", () => {
    const rt = createTestRuntime(buildDoc({ patches: { sum: { type: "add", inputs: { value1: { loop: [1, 2, 3, 4, 5, 6] }, value2: { loop: [100, 200] } } } } }));
    rt.step();
    expect(items(rt.getRawValue("sum.output"))).toEqual([101, 202, 103, 204, 105, 206]);
    expect(rt.getValue("sum.output#3")).toBe(204);
    expect(rt.getValue("sum.output")).toBe(101);
  });

  it("scalars broadcast to every index", () => {
    const rt = createTestRuntime(buildDoc({ patches: { sum: { type: "add", inputs: { value1: { loop: [1, 2, 3] }, value2: 10 } } } }));
    rt.step();
    expect(items(rt.getRawValue("sum.output"))).toEqual([11, 12, 13]);
  });

  it("an empty loop produces an empty loop and runs nothing", () => {
    const rt = createTestRuntime(buildDoc({ patches: { sum: { type: "add", inputs: { value1: { loop: [] }, value2: 10 } } } }));
    rt.step();
    const v = rt.getRawValue("sum.output");
    expect(isLoop(v)).toBe(true);
    expect(items(v)).toEqual([]);
  });

  it("a one-item loop evaluates once and outputs a plain value (length-1 rule)", () => {
    const rt = createTestRuntime(buildDoc({ patches: { sum: { type: "add", inputs: { value1: { loop: [5] }, value2: 1 } } } }));
    rt.step();
    expect(rt.getRawValue("sum.output")).toBe(6);
  });

  it("stateful patches keep per-index state; indices are created and dropped as counts change", () => {
    const pulses = sequenceDefinition("pulses", "pulse", [makeLoop([true, false, true]), makeLoop([false, false, true]), makeLoop([true]), makeLoop([false, true, false])]);
    const reg = createMockRegistry([pulses]);
    const rt = createTestRuntime(buildDoc({ patches: { src: { type: "pulses" }, count: { type: "counter", inputs: { increase: { link: "src.value" } } } } }, reg), reg);
    const seen: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      rt.step();
      seen.push(items(rt.getRawValue("count.count")));
    }
    expect(seen).toEqual([[1, 0, 1], [1, 0, 2], 2, [2, 1, 0]]);
  });

  it("disposes the state of removed indices", () => {
    const log: string[] = [];
    const sizes = sequenceDefinition("sizes", "number", [makeLoop([1, 2, 3]), makeLoop([1]), makeLoop([1, 2])]);
    const reg = createMockRegistry([sizes, probeDefinition(log)]);
    const rt = createTestRuntime(buildDoc({ patches: { src: { type: "sizes" }, p: { type: "probe", inputs: { value: { link: "src.value" } } } } }, reg), reg);
    rt.step();
    expect(items(rt.getRawValue("p.count"))).toEqual([1, 1, 1]);
    rt.step();
    expect(log).toEqual(["dispose main#2", "dispose main#1"]);
    expect(rt.getRawValue("p.count")).toBe(2);
    rt.step();
    expect(items(rt.getRawValue("p.count"))).toEqual([3, 1]);
  });

  it("whole-loop ports receive every item and produce loops", () => {
    const rt = createTestRuntime(
      buildDoc({
        patches: {
          idx: { type: "loop", inputs: { count: 4 } },
          total: { type: "loopSum", inputs: { loop: { link: "idx.index" } } },
          doubled: { type: "multiply", inputs: { a: { link: "idx.index" }, b: 2 } },
        },
      }),
    );
    rt.step();
    expect(items(rt.getRawValue("idx.index"))).toEqual([0, 1, 2, 3]);
    expect(rt.getValue("total.sum")).toBe(6);
    expect(items(rt.getRawValue("doubled.output"))).toEqual([0, 2, 4, 6]);
  });

  it("caps loops at 10,000 items with an issue", () => {
    const rt = createTestRuntime(buildDoc({ patches: { idx: { type: "loop", inputs: { count: 10_005 } }, m: { type: "multiply", inputs: { a: { link: "idx.index" } } } } }));
    rt.step();
    expect((rt.getRawValue("m.output") as { items: unknown[] }).items).toHaveLength(10_000);
    expect(rt.issues().map((i) => i.code)).toContain("loop_limit");
  });
});

describe("loops: layers", () => {
  const listDoc = () =>
    buildDoc({
      layers: [
        {
          id: "row",
          type: "group",
          name: "Row",
          props: { position: { link: "pos.output" }, size: [200, 40] },
          children: [{ id: "title", type: "text", name: "Title", props: { text: { link: "names.output" } } }],
        },
      ],
      patches: {
        pos: { type: "splitter", typeParam: "point", inputs: { value: { loop: [[0, 0], [0, 50], [0, 100]] } } },
        names: { type: "splitter", typeParam: "text", inputs: { value: { loop: ["a", "b", "c"] } } },
      },
    });

  it("replicates a layer per loop item with keys id#n; descendants inherit the index", () => {
    const rt = createTestRuntime(listDoc());
    const frame = rt.step();
    expect(frame.roots.map((n) => n.key)).toEqual(["row#0", "row#1", "row#2"]);
    expect(frame.roots.map((n) => n.y)).toEqual([0, 50, 100]);
    expect(frame.roots[1]!.children.map((c) => [c.key, c.props.text, c.parentKey])).toEqual([["title#1", "b", "row#1"]]);
    expect(rt.getValue("@title.text#2")).toBe("c");
    expect(rt.hitTest(190, 60)[0]).toEqual({ key: "row#1", layerId: "row" });
  });

  it("a layer bound to an empty loop renders no copies", () => {
    const doc = structuredClone(listDoc());
    doc.components.main!.patches.pos!.inputs.value = { loop: [] };
    const rt = createTestRuntime(doc);
    expect(rt.step().roots).toEqual([]);
  });

  it("interactions on a replicated layer produce looped outputs and per-index state", () => {
    const doc = buildDoc({
      layers: [{ id: "card", type: "rectangle", name: "Card", props: { position: { link: "pos.output" }, size: [200, 80] } }],
      patches: {
        pos: { type: "splitter", typeParam: "point", inputs: { value: { loop: [[0, 0], [0, 100], [0, 200]] } } },
        touch: { type: "interaction", inputs: { layer: { layer: "card" } } },
        toggle: { type: "switch", inputs: { flip: { link: "touch.tap" } } },
      },
    });
    const rt = createTestRuntime(doc);
    runFrames(rt, 2);
    runFrames(rt, 2, tap(50, 140));
    expect(items(rt.getRawValue("touch.tap"))).toEqual([false, true, false]);
    expect(items(rt.getRawValue("toggle.on"))).toEqual([false, true, false]);
    rt.step();
    expect(items(rt.getRawValue("touch.tap"))).toEqual([false, false, false]);
    expect(items(rt.getRawValue("toggle.on"))).toEqual([false, true, false]);
  });
});

describe("loops: empty loops and feedback", () => {
  /** Counts the items of a whole loop of layer references (like Loop Count on a layer). */
  const countRefs = defineMock({
    type: "countRefs",
    name: "Count Refs",
    inputs: [port("layers", "layer", { wholeLoop: true, default: { loop: [] } as never })],
    outputs: [port("count", "number")],
    evaluate(ctx) {
      ctx.output("count", ctx.inputItems("layers").length);
    },
  });
  const reg = createMockRegistry([countRefs]);
  const withLiteral = (doc: SonobeDocument, id: string, key: string, value: unknown) => {
    const next = structuredClone(doc);
    next.components.main!.patches[id]!.inputs[key] = value as never;
    return next;
  };
  const place = (doc: SonobeDocument, positions: Record<string, number>) => {
    const next = structuredClone(doc);
    for (const [id, x] of Object.entries(positions)) next.components.main!.patches[id]!.ui = { x, y: 0 };
    return next;
  };
  /** Guide 07's tap-to-grow list: the rows' scale comes from their own Interaction, so the layer reads itself. */
  const rows = (positions: unknown[]) =>
    buildDoc(
      {
        layers: [{ id: "row", type: "rectangle", name: "Row", props: { position: { link: "pos.output" }, size: [200, 40], scale: { link: "grow.output" } } }],
        patches: {
          pos: { type: "splitter", typeParam: "point", inputs: { value: { loop: positions as never } } },
          touch: { type: "interaction", inputs: { layer: { layer: "row" } } },
          toggle: { type: "switch", inputs: { flip: { link: "touch.tap" } } },
          grow: { type: "transition", inputs: { progress: { link: "toggle.on" }, start: 1, end: 1.1 } },
          copies: { type: "countRefs", inputs: { layers: { layer: "row" } } },
        },
      },
      reg,
    );
  const three = [
    [0, 0],
    [0, 50],
    [0, 100],
  ];

  it("a layer with 0 copies reads as one reference for per-item readers and as an empty loop for whole-loop readers", () => {
    const rt = createTestRuntime(rows([]), reg);
    runFrames(rt, 2);
    expect(rt.step().roots).toEqual([]);
    // Interaction runs once against the undrawn layer (a scalar, not an empty loop); its hit tests miss.
    expect(rt.getRawValue("touch.tap")).toBe(false);
    expect(rt.getRawValue("toggle.on")).toBe(false);
    expect(rt.getRawValue("touch.layer")).toEqual({ layerId: "row" });
    expect(rt.getRawValue("copies.count")).toBe(0);
  });

  it("a replicated layer whose list is empty for a frame comes back, with per-copy state intact", () => {
    const full = rows(three);
    const rt = createTestRuntime(full, reg);
    runFrames(rt, 2);
    rt.updateDocument(withLiteral(full, "pos", "value", { loop: [] }));
    expect(rt.step().roots).toEqual([]);
    rt.updateDocument(full);
    runFrames(rt, 3);
    expect(rt.scene().roots.map((n) => n.key)).toEqual(["row#0", "row#1", "row#2"]);
    runFrames(rt, 2, tap(50, 60));
    expect(items(rt.getRawValue("toggle.on"))).toEqual([false, true, false]);
    expect(rt.getRawValue("copies.count")).toBe(3);
  });

  it("a feedback cable never carries an empty loop into a per-item input", () => {
    // sum = src + last frame's sum. When src is empty for a frame, so is sum; the next frame Delay One
    // Frame reads that empty loop as "no value yet" (0), and sum refills from src.
    const src = sequenceDefinition("src", "number", [makeLoop([1, 2, 3]), makeLoop([]), makeLoop([1, 2, 3])]);
    const r = createMockRegistry([src]);
    const doc = buildDoc({ patches: { src: { type: "src" }, sum: { type: "add", inputs: { value1: { link: "src.value" }, value2: { link: "d.output" } } }, d: { type: "delay1", inputs: { value: { link: "sum.output" } } } } }, r);
    const rt = createTestRuntime(doc, r);
    const seen: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      rt.step();
      seen.push(items(rt.getRawValue("sum.output")));
    }
    expect(seen).toEqual([[1, 2, 3], [], [1, 2, 3], [2, 4, 6], [3, 6, 9]]);
  });

  it("an empty loop read through a back-edge at a whole-loop input stays empty, and a steady empty cycle asks for no frames", () => {
    const src = sequenceDefinition("src", "number", [makeLoop([1, 2, 3]), makeLoop([])]);
    const r = createMockRegistry([src]);
    // total reads b through a visually backwards cable: last frame's loop, whole.
    const doc = place(buildDoc({ patches: { src: { type: "src" }, total: { type: "loopSum", inputs: { loop: { link: "b.output" } } }, b: { type: "add", inputs: { value1: { link: "src.value" }, value2: { link: "total.sum" } } } } }, r), { total: 0, b: 200 });
    expect(compileDocument(doc, r).order.find((n) => n.id === "total")!.feedback).toEqual([true]);
    const rt = createTestRuntime(doc, r);
    runFrames(rt, 4);
    expect(rt.getRawValue("total.loop")).toEqual(makeLoop([]));
    expect(rt.getRawValue("total.sum")).toBe(0);
    expect(rt.needsNextFrame).toBe(false);
  });

  it("asks for frames again once an empty cycle's driver refills", () => {
    const src = sequenceDefinition("src", "number", [makeLoop([]), makeLoop([]), makeLoop([]), makeLoop([1, 2])]);
    const r = createMockRegistry([src]);
    const doc = buildDoc({ patches: { src: { type: "src" }, sum: { type: "add", inputs: { value1: { link: "src.value" }, value2: { link: "d.output" } } }, d: { type: "delay1", inputs: { value: { link: "sum.output" } } } } }, r);
    const rt = createTestRuntime(doc, r);
    runFrames(rt, 3);
    expect(rt.getRawValue("sum.output")).toEqual(makeLoop([]));
    expect(rt.needsNextFrame).toBe(false);
    rt.step();
    expect(items(rt.getRawValue("sum.output"))).toEqual([1, 2]);
    expect(rt.needsNextFrame).toBe(true);
  });

  it("a component whose copies read an empty loop through a back-edge comes back", () => {
    const echo: ComponentInput = {
      id: "echo",
      kind: "patchComponent",
      inputs: { v: { type: "number", default: 0 } },
      outputs: { out: { type: "number", link: "s.output" } },
      patches: { s: { type: "splitter", inputs: { value: { link: "$in.v" } } } },
    };
    const src = sequenceDefinition("src", "number", [makeLoop([1, 2, 3]), makeLoop([]), makeLoop([1, 2, 3])]);
    const r = createMockRegistry([src]);
    // sum sits right of the component, so the cable into the component's copies is the back-edge.
    const doc = place(
      buildDoc({ components: [echo], patches: { src: { type: "src" }, inst: { type: "component", component: "echo", inputs: { v: { link: "sum.output" } } }, sum: { type: "add", inputs: { value1: { link: "src.value" }, value2: { link: "inst.out" } } } } }, r),
      { inst: 0, sum: 200 },
    );
    const graph = compileDocument(doc, r);
    expect(graph.order.find((n) => n.kind === "copies")!.feedback).toEqual([true]);
    expect(graph.cyclic).toBe(true);
    const rt = createTestRuntime(doc, r);
    runFrames(rt, 2);
    expect(rt.getRawValue("sum.output")).toEqual(makeLoop([]));
    runFrames(rt, 3);
    expect(items(rt.getRawValue("inst.out"))).toHaveLength(3);
    expect(items(rt.getRawValue("sum.output"))).toHaveLength(3);
  });

  it("keeps the same-frame rule: an empty list still hides its layer's copies, quietly", () => {
    const rt = createTestRuntime(rows([]), reg);
    for (let i = 0; i < 5; i++) expect(rt.step().roots).toEqual([]);
    expect(rt.issues().filter((i) => i.code === "empty_loop")).toEqual([]);
  });

  it("a trace of a runtime that recovered from an empty frame replays the recovery", () => {
    const full = rows(three);
    const rt = createTestRuntime(full, reg);
    runFrames(rt, 2);
    rt.updateDocument(withLiteral(full, "pos", "value", { loop: [] }));
    rt.step();
    rt.updateDocument(full);
    runFrames(rt, 2);
    expect(rt.getRawValue("copies.count")).toBe(3);
    const traced = rt.trace(["copies.count"], 50);
    expect(traced.values["copies.count"]!.every((v) => v === 3)).toBe(true);
  });
});
