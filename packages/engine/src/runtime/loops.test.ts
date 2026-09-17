import { describe, expect, it } from "vitest";
import { buildDoc, createMockRegistry, createTestRuntime, probeDefinition, runFrames, sequenceDefinition, tap } from "../testing/index.ts";
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
