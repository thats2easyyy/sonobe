import { applyOps, type InputValue, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { buildDoc, createMockRegistry, createTestRuntime, defineMock, port, probeDefinition, runFrames, sequenceDefinition, tap, type ComponentInput } from "../testing/index.ts";
import { compileDocument, updateLiterals } from "./compile.ts";
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

describe("loops: Repeat", () => {
  /** A card whose own props come only from an Interaction on itself, with a looped title inside. */
  const deck = (repeat?: unknown) =>
    buildDoc({
      layers: [
        {
          id: "card",
          type: "group",
          name: "Card",
          props: { size: [300, 200], scale: { link: "grow.output" }, ...(repeat === undefined ? {} : { repeat: repeat as InputValue }) },
          children: [{ id: "title", type: "text", name: "Title", props: { text: { link: "names.output" } } }],
        },
      ],
      patches: {
        names: { type: "splitter", typeParam: "text", inputs: { value: { loop: ["A", "B", "C", "D"] } } },
        touch: { type: "interaction", inputs: { layer: { layer: "card" } } },
        toggle: { type: "switch", inputs: { flip: { link: "touch.tap" } } },
        grow: { type: "transition", inputs: { progress: { link: "toggle.on" }, start: 1, end: 1.1 } },
      },
    });
  const keys = (rt: ReturnType<typeof createTestRuntime>) => rt.scene().roots.map((n) => n.key);
  /** The document with the card's Repeat set (undefined clears it), sharing everything else. */
  const withRepeat = (doc: SonobeDocument, value: unknown) => {
    const result = applyOps(doc, [{ op: "setInput", target: "@card.repeat", value: (value ?? null) as never }], { registry: createMockRegistry() });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    return result.doc;
  };

  it("makes a card whose props come from its own gesture one copy per item, and the gesture runs per copy", () => {
    // Without Repeat, the titles repeat inside one card (the retro's stuck deck).
    const stuck = createTestRuntime(deck());
    runFrames(stuck, 2);
    expect(keys(stuck)).toEqual(["card"]);
    expect(stuck.scene().roots[0]!.children.map((c) => c.key)).toEqual(["title#0", "title#1", "title#2", "title#3"]);

    const rt = createTestRuntime(deck({ link: "names.output" }));
    expect(rt.step().roots.map((n) => [n.key, n.children.map((c) => `${c.key}=${c.props.text}`)])).toEqual([
      ["card#0", ["title#0=A"]],
      ["card#1", ["title#1=B"]],
      ["card#2", ["title#2=C"]],
      ["card#3", ["title#3=D"]],
    ]);
    runFrames(rt, 2, tap(150, 100));
    // Copies stack; the last copy is on top and gets the tap.
    expect(items(rt.getRawValue("touch.tap"))).toHaveLength(4);
    expect(items(rt.getRawValue("toggle.on"))).toEqual([false, false, false, true]);
  });

  it("a typed number makes that many copies, 0 makes none quietly, and a linked number rounds down", () => {
    const rt = createTestRuntime(deck(3));
    rt.step();
    expect(keys(rt)).toEqual(["card#0", "card#1", "card#2"]);
    const none = createTestRuntime(deck(0));
    runFrames(none, 3);
    expect(keys(none)).toEqual([]);
    expect(none.issues()).toEqual([]);
    const linked = createTestRuntime(
      buildDoc({
        layers: [{ id: "dot", type: "rectangle", name: "Dot", props: { repeat: { link: "n.output" } } }],
        patches: { n: { type: "add", inputs: { value1: 2, value2: 0.7 } } },
      }),
    );
    linked.step();
    expect(keys(linked)).toEqual(["dot#0", "dot#1"]);
  });

  it("counts a loop of any item type by its length", () => {
    const rt = createTestRuntime(
      buildDoc({
        layers: [{ id: "swatch", type: "rectangle", name: "Swatch", props: { repeat: { link: "colors.output" } } }],
        patches: { colors: { type: "splitter", typeParam: "color", inputs: { value: { loop: ["#FF0000FF", "#00FF00FF"] } } } },
      }),
    );
    rt.step();
    expect(keys(rt)).toEqual(["swatch#0", "swatch#1"]);
  });

  it("alone decides the count: longer and shorter loops on the layer and inside it wrap per copy", () => {
    const doc = buildDoc({
      layers: [
        {
          id: "row",
          type: "group",
          name: "Row",
          props: { repeat: 5, position: { link: "pos.output" }, size: [100, 20] },
          children: [{ id: "label", type: "text", name: "Label", props: { text: { link: "names.output" } } }],
        },
      ],
      patches: {
        pos: { type: "splitter", typeParam: "point", inputs: { value: { loop: [[0, 0], [0, 30], [0, 60]] } } },
        names: { type: "splitter", typeParam: "text", inputs: { value: { loop: ["a", "b", "c", "d", "e", "f", "g"] } } },
      },
    });
    const five = createTestRuntime(doc);
    const frame = five.step();
    expect(frame.roots.map((n) => [n.key, n.y, n.children[0]!.props.text])).toEqual([
      ["row#0", 0, "a"],
      ["row#1", 30, "b"],
      ["row#2", 60, "c"],
      ["row#3", 0, "d"],
      ["row#4", 30, "e"],
    ]);
    // Reads agree with what each copy draws.
    expect(five.getValue("@row.position#3")).toEqual([0, 0]);
    expect(five.getValue("@label.text#4")).toBe("e");
  });

  it("an empty looped property reads its default on every copy under Repeat, and nothing warns (the empty-loop rule gives way)", () => {
    const doc = buildDoc({
      layers: [{ id: "tile", type: "rectangle", name: "Tile", props: { repeat: 3, size: [40, 40], color: { link: "none.output" } } }],
      patches: { none: { type: "splitter", typeParam: "color", inputs: { value: { loop: [] } } } },
    });
    const rt = createTestRuntime(doc);
    runFrames(rt, 3);
    const tiles = rt.scene().roots;
    expect(tiles.map((n) => n.key)).toEqual(["tile#0", "tile#1", "tile#2"]);
    const fallback = createTestRuntime(buildDoc({ layers: [{ id: "tile", type: "rectangle", name: "Tile" }] })).step().roots[0]!.props.color;
    expect(tiles.map((n) => n.props.color)).toEqual([fallback, fallback, fallback]);
    expect(rt.getValue("@tile.color#1")).toEqual(fallback);
    expect(rt.inspect("@tile.color#1").note).toMatch(/^Every copy of "Tile" uses the default\. It's an empty loop/);
    expect(rt.issues()).toEqual([]);
  });

  it("follows the document across hot-swaps, from a count stuck at 1 or 0", () => {
    const rt = createTestRuntime(deck());
    runFrames(rt, 2);
    expect(keys(rt)).toEqual(["card"]);
    const counts: number[] = [];
    for (const value of [{ link: "names.output" }, 0, { link: "names.output" }, undefined]) {
      rt.updateDocument(withRepeat(rt.document, value));
      runFrames(rt, 2);
      counts.push(rt.scene().roots.length);
    }
    expect(counts).toEqual([4, 0, 4, 4]);
  });

  it("patches literal edits in place", () => {
    const doc = deck(5);
    const rt = createTestRuntime(doc);
    rt.step();
    const graph = compileDocument(doc, createMockRegistry());
    for (const n of [3, 0, 2]) {
      const next = withRepeat(rt.document, n);
      expect(updateLiterals(graph, next)).toBe(true);
      rt.updateDocument(next);
      rt.step();
      expect(rt.scene().roots).toHaveLength(n);
    }
  });

  it("draws and reads Repeat as the number of copies, not the loop it counts", () => {
    const rt = createTestRuntime(deck({ link: "names.output" }));
    rt.step();
    expect(rt.scene().roots.map((n) => n.props.repeat)).toEqual([4, 4, 4, 4]);
    expect(rt.getValue("@card.repeat")).toBe(4);
    expect(rt.getValue("@title.repeat")).toBe(4);
    const single = createTestRuntime(buildDoc({ layers: [{ id: "box", type: "rectangle", name: "Box" }] }));
    single.step();
    expect(single.getValue("@box.repeat")).toBe(1);
  });

  it("a patch linked to @card.repeat reads the copies last frame drew, whether Repeat is linked, Auto or typed", () => {
    const lastIndex = (props: Record<string, InputValue>) => {
      const rt = createTestRuntime(
        buildDoc({
          layers: [{ id: "card", type: "rectangle", name: "Card", props }],
          patches: {
            names: { type: "splitter", typeParam: "text", inputs: { value: { loop: ["A", "B", "C", "D"] } } },
            rows: { type: "splitter", typeParam: "point", inputs: { value: { loop: [[0, 0], [0, 10], [0, 20], [0, 30]] } } },
            last: { type: "add", inputs: { value1: { link: "@card.repeat" }, value2: -1 } },
          },
        }),
      );
      rt.step();
      // The first frame changed the count from the scene before it (1 copy while no patch had run), so
      // the runtime asks for a frame that reads the new one.
      const asked = rt.needsNextFrame;
      runFrames(rt, 2);
      expect(rt.needsNextFrame).toBe(false);
      expect(rt.issues()).toEqual([]);
      return [rt.scene().roots.length, rt.getRawValue("last.output"), asked];
    };
    expect(lastIndex({ repeat: { link: "names.output" } })).toEqual([4, 3, true]);
    expect(lastIndex({ position: { link: "rows.output" } })).toEqual([4, 3, true]);
    expect(lastIndex({ repeat: 3 })).toEqual([3, 2, false]);
  });

  it("a layer inside a layer that drew 0 copies reads 0 copies too, and inspect says which layer hid it", () => {
    const doc = (repeat: InputValue | undefined, others: Record<string, InputValue> = {}) =>
      buildDoc({
        layers: [
          {
            id: "card",
            type: "group",
            name: "Card",
            props: { ...(repeat === undefined ? {} : { repeat }), ...others },
            children: [
              { id: "title", type: "text", name: "Title", props: { text: "Hi" } },
              { id: "inner", type: "group", name: "Inner", children: [{ id: "badge", type: "rectangle", name: "Badge", props: { opacity: 0.7, color: { link: "tints.output" } } }] },
            ],
          },
        ],
        patches: {
          none: { type: "splitter", typeParam: "point", inputs: { value: { loop: [] } } },
          tints: { type: "splitter", typeParam: "color", inputs: { value: { loop: ["#FF0000FF", "#00FF00FF"] } } },
        },
      });
    const none = createTestRuntime(doc(0));
    runFrames(none, 2);
    expect(none.scene().roots).toEqual([]);
    expect(none.inspect("@card.opacity")).toEqual({ value: 1, copies: 0, note: 'Not drawn: Layer "Card" has 0 copies.' });
    expect(none.inspect("@title.text")).toEqual({ value: "Hi", copies: 0, note: 'Not drawn: it\'s inside Layer "Card". Layer "Card" has 0 copies.' });
    expect(none.inspect("@badge.opacity#1")).toEqual({ value: 0.7, copies: 0, note: 'Not drawn: it\'s inside Layer "Card". Layer "Card" has 0 copies.' });
    expect(none.getValue("@title.repeat")).toBe(0);

    const emptied = createTestRuntime(doc(undefined, { position: { link: "none.output" } }));
    runFrames(emptied, 2);
    const why = emptied.inspect("@card.position").note!;
    expect(why).toMatch(/^Not drawn: Layer "Card" has 0 copies because its Position/);
    expect(emptied.inspect("@badge.opacity")).toEqual({ value: 0.7, copies: 0, note: `Not drawn: it's inside Layer "Card". ${why.slice("Not drawn: ".length)}` });

    const drawn = createTestRuntime(doc(2));
    runFrames(drawn, 2);
    expect(drawn.inspect("@badge.opacity")).toEqual({ value: 0.7, copies: 2, note: "copy #0 of 2" });
  });

  it("a component instance inside a layer that drew 0 copies isn't drawn, and inspect says so from inside it", () => {
    const chip: ComponentInput = { id: "chip", kind: "layerComponent", size: [80, 40], layers: [{ id: "label", type: "text", name: "Label", props: { text: "Chip" } }] };
    const rt = createTestRuntime(
      buildDoc({ components: [chip], layers: [{ id: "row", type: "group", name: "Row", props: { repeat: 0 }, children: [{ id: "c1", type: "componentInstance", name: "Chip", component: "chip", props: {} }] }] }),
    );
    runFrames(rt, 2);
    expect(rt.inspect("@c1/label.text")).toEqual({ value: "Chip", copies: 0, note: 'Not drawn: it\'s inside Layer "Row". Layer "Row" has 0 copies.' });
  });

  it("inspect says how many copies a layer has and which one it read", () => {
    const one = createTestRuntime(deck());
    one.step();
    expect(one.inspect("@card.scale#2")).toEqual({ value: 1, copies: 1, note: 'Layer "Card" has 1 copy, so there\'s no #2.' });
    expect(one.inspect("@card.scale")).toEqual({ value: 1, copies: 1 });
    const four = createTestRuntime(deck({ link: "names.output" }));
    four.step();
    expect(four.inspect("@card.scale")).toEqual({ value: 1, copies: 4, note: "copy #0 of 4" });
    expect(four.inspect("@title.text#3")).toEqual({ value: "D", copies: 4 });
    expect(four.inspect("@card.repeat")).toEqual({ value: 4, copies: 4 });
    expect(four.inspect("@card.scale#4").note).toBe('Layer "Card" has 4 copies (#0 to #3), so there\'s no #4.');
  });

  it("is ignored under a layer that already makes copies: one child per parent copy", () => {
    const doc = buildDoc({
      layers: [{ id: "card", type: "group", name: "Card", props: { repeat: 2 }, children: [{ id: "badge", type: "rectangle", name: "Badge", props: { repeat: 3 } }] }],
    });
    const rt = createTestRuntime(doc);
    rt.step();
    expect(rt.scene().roots.map((n) => [n.key, n.children.map((c) => c.key)])).toEqual([
      ["card#0", ["badge#0"]],
      ["card#1", ["badge#1"]],
    ]);
  });

  it("makes 1 copy of a value that isn't a count, and says so", () => {
    const doc = buildDoc({
      layers: [{ id: "card", type: "rectangle", name: "Card", props: { repeat: { link: "label.output" } } }],
      patches: { label: { type: "splitter", typeParam: "text", inputs: { value: "four" } } },
    });
    const rt = createTestRuntime(doc);
    rt.step();
    expect(keys(rt)).toEqual(["card#0"]);
    expect(rt.issues()).toEqual([
      expect.objectContaining({ code: "repeat_not_a_count", severity: "warning", layerId: "card", message: 'Layer "Card" gets text "four" on its Repeat, which counts copies, so it makes 1 copy. Link a loop (one copy per item) or a number.' }),
    ]);
  });
});

describe("loops: loop_length_mismatch", () => {
  const mismatches = (rt: ReturnType<typeof createTestRuntime>) => rt.issues().filter((i) => i.code === "loop_length_mismatch");
  /** A card repeated `count` times whose photo reads a loop only the running prototype knows the length of. */
  const cards = (repeat: unknown, values: readonly unknown[]) => {
    const colors = sequenceDefinition("colors", "color", values);
    const reg = createMockRegistry([colors]);
    const doc = buildDoc(
      {
        layers: [{ id: "card", type: "group", name: "Card", props: { repeat: repeat as never }, children: [{ id: "photo", type: "rectangle", name: "Photo", props: { color: { link: "src.value" } } }] }],
        patches: { src: { type: "colors" } },
      },
      reg,
    );
    return createTestRuntime(doc, reg);
  };
  const three = makeLoop([{ r: 1, g: 0, b: 0, a: 1 }, { r: 0, g: 1, b: 0, a: 1 }, { r: 0, g: 0, b: 1, a: 1 }]);

  it("warns once when a ×4 card's photo reads a loop of 3, after two frames in a row", () => {
    const rt = cards(4, [three]);
    rt.step();
    expect(mismatches(rt)).toEqual([]);
    runFrames(rt, 4);
    expect(mismatches(rt)).toEqual([
      {
        code: "loop_length_mismatch",
        severity: "warning",
        layerId: "card",
        message: 'Layer "Card" makes 4 copies, but the Color of "Photo" is a loop of 3 right now, so copy #3 shows item #0 again.',
        hint: "These lengths come from the running prototype, like a filtered list or a count from data. Give the loops the same number of items, or link Repeat to the loop the copies should follow.",
      },
    ]);
  });

  it("stays quiet for stripes (6 copies, 2 colors) and for a typed Repeat that shows the first items", () => {
    const two = makeLoop([{ r: 1, g: 1, b: 1, a: 1 }, { r: 0.9, g: 0.9, b: 0.9, a: 1 }]);
    const striped = cards(6, [two]);
    runFrames(striped, 4);
    expect(mismatches(striped)).toEqual([]);
    const firstTwo = cards(2, [three]);
    runFrames(firstTwo, 4);
    expect(mismatches(firstTwo)).toEqual([]);
  });

  it("leaves lengths the document fixes to diagnostics", () => {
    const doc = buildDoc({
      layers: [{ id: "card", type: "group", name: "Card", props: { repeat: 4 }, children: [{ id: "photo", type: "rectangle", name: "Photo", props: { color: { link: "colors.output" } } }] }],
      patches: { colors: { type: "splitter", typeParam: "color", inputs: { value: { loop: ["#FF0000FF", "#00FF00FF", "#0000FFFF"] } } } },
    });
    const rt = createTestRuntime(doc);
    runFrames(rt, 4);
    expect(mismatches(rt)).toEqual([]);
  });

  it("doesn't warn on the frame after the count grows, while gestures still see last frame's copies", () => {
    // The count goes 4 → 5; the Interaction on the card reads last frame's 4 copies for one frame.
    const src = sequenceDefinition("src", "number", [makeLoop([0, 1, 2, 3]), makeLoop([0, 1, 2, 3]), makeLoop([0, 1, 2, 3, 4])]);
    const reg = createMockRegistry([src]);
    const doc = buildDoc(
      {
        layers: [{ id: "card", type: "rectangle", name: "Card", props: { repeat: { link: "src.value" }, scale: { link: "grow.output" } } }],
        patches: {
          src: { type: "src" },
          touch: { type: "interaction", inputs: { layer: { layer: "card" } } },
          grow: { type: "transition", inputs: { progress: { link: "touch.down" }, start: 1, end: 1.1 } },
        },
      },
      reg,
    );
    const rt = createTestRuntime(doc, reg);
    for (let i = 0; i < 6; i++) {
      rt.step();
      expect(mismatches(rt)).toEqual([]);
    }
    expect(rt.scene().roots).toHaveLength(5);
  });

  it("goes away when an edit makes the loops fit", () => {
    const rt = cards(4, [three]);
    runFrames(rt, 3);
    expect(mismatches(rt)).toHaveLength(1);
    const next = structuredClone(rt.document);
    next.components.main!.layers[0]!.props.repeat = 3;
    rt.updateDocument(next);
    runFrames(rt, 3);
    expect(mismatches(rt)).toEqual([]);
  });
});
