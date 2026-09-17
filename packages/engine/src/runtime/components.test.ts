import { describe, expect, it } from "vitest";
import { buildDoc, createMockRegistry, createTestRuntime, probeDefinition, runFrames, sequenceDefinition, tap, type ComponentInput } from "../testing/index.ts";
import { isLoop, makeLoop } from "./loop.ts";

const items = (v: unknown) => (isLoop(v) ? v.items : v);

function doubler(loopBehavior?: "loop" | "pass"): ComponentInput {
  return {
    id: "doubler",
    kind: "patchComponent",
    inputs: { x: { type: "number", default: 3, ...(loopBehavior ? { loopBehavior } : {}) } },
    outputs: { y: { type: "number", link: "mul.output" } },
    patches: { mul: { type: "multiply", inputs: { a: { link: "$in.x" }, b: 2 } } },
  };
}

function steps(rt: ReturnType<typeof createTestRuntime>, n: number, address: string): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < n; i++) {
    rt.step();
    out.push(items(rt.getRawValue(address)));
  }
  return out;
}

describe("components: patch components", () => {
  it("inlines instances so values cross the boundary in both directions on the same frame", () => {
    const rt = createTestRuntime(
      buildDoc({
        components: [doubler()],
        patches: {
          src: { type: "splitter", inputs: { value: 5 } },
          dbl: { type: "component", component: "doubler", inputs: { x: { link: "src.output" } } },
          out: { type: "multiply", inputs: { a: { link: "dbl.y" }, b: 10 } },
        },
      }),
    );
    rt.step();
    expect(rt.getValue("dbl.y")).toBe(10);
    expect(rt.getValue("out.output")).toBe(100);
    expect(rt.issues()).toEqual([]);
  });

  it("unset published inputs use the interface default", () => {
    const rt = createTestRuntime(buildDoc({ components: [doubler()], patches: { dbl: { type: "component", component: "doubler" } } }));
    rt.step();
    expect(rt.getValue("dbl.y")).toBe(6);
  });

  it("loop the component: one copy per item, flattened outputs, per-copy component paths", () => {
    const log: string[] = [];
    const reg = createMockRegistry([probeDefinition(log)]);
    const component: ComponentInput = {
      ...doubler(),
      outputs: { y: { type: "number", link: "mul.output" }, path: { type: "text", link: "p.path" } },
      patches: { mul: { type: "multiply", inputs: { a: { link: "$in.x" }, b: 2 } }, p: { type: "probe", inputs: { value: { link: "$in.x" } } } },
    };
    const rt = createTestRuntime(buildDoc({ components: [component], patches: { dbl: { type: "component", component: "doubler", inputs: { x: { loop: [1, 2, 3] } } } } }, reg), reg);
    rt.step();
    expect(items(rt.getRawValue("dbl.y"))).toEqual([2, 4, 6]);
    expect(items(rt.getRawValue("dbl.path"))).toEqual(["main/dbl#0#0", "main/dbl#1#0", "main/dbl#2#0"]);
  });

  it("pass into the component: the whole loop arrives in one instance", () => {
    const summer: ComponentInput = {
      id: "summer",
      kind: "patchComponent",
      inputs: { values: { type: "number", loopBehavior: "pass" } },
      outputs: { sum: { type: "number", link: "total.sum" } },
      patches: { total: { type: "loopSum", inputs: { loop: { link: "$in.values" } } } },
    };
    const rt = createTestRuntime(buildDoc({ components: [summer], patches: { s: { type: "component", component: "summer", inputs: { values: { loop: [1, 2, 3, 4] } } } } }));
    rt.step();
    expect(rt.getRawValue("s.sum")).toBe(10);
  });

  it("copies keep their own state, pulses cross the boundary, and removed copies dispose", () => {
    const log: string[] = [];
    const ticks = sequenceDefinition("ticks", "pulse", [makeLoop([true, false, true]), makeLoop([true, true, false]), makeLoop([true])]);
    const reg = createMockRegistry([ticks, probeDefinition(log)]);
    const tally: ComponentInput = {
      id: "tally",
      kind: "patchComponent",
      inputs: { tick: { type: "pulse" } },
      outputs: { count: { type: "number", link: "count.count" } },
      patches: {
        count: { type: "counter", inputs: { increase: { link: "$in.tick" } } },
        p: { type: "probe", inputs: { value: { link: "count.count" } } },
      },
    };
    const rt = createTestRuntime(buildDoc({ components: [tally], patches: { src: { type: "ticks" }, t: { type: "component", component: "tally", inputs: { tick: { link: "src.value" } } } } }, reg), reg);
    expect(steps(rt, 3, "t.count")).toEqual([[1, 0, 1], [2, 1, 1], [3]]);
    expect(log).toEqual(["dispose main/t#1#0", "dispose main/t#2#0"]);
  });

  it("copy 0 shares state with the unreplicated instance, so a scalar becoming a one-item loop resets nothing", () => {
    const ticks = sequenceDefinition("ticks", "pulse", [true, makeLoop([true]), makeLoop([true, true]), true]);
    const reg = createMockRegistry([ticks]);
    const tally: ComponentInput = {
      id: "tally",
      kind: "patchComponent",
      inputs: { tick: { type: "pulse" } },
      outputs: { count: { type: "number", link: "count.count" } },
      patches: { count: { type: "counter", inputs: { increase: { link: "$in.tick" } } } },
    };
    const rt = createTestRuntime(buildDoc({ components: [tally], patches: { src: { type: "ticks" }, t: { type: "component", component: "tally", inputs: { tick: { link: "src.value" } } } } }, reg), reg);
    expect(steps(rt, 4, "t.count")).toEqual([1, [2], [3, 1], 4]);
  });

  it("muted instances pass the first published input of the same type through", () => {
    const rt = createTestRuntime(
      buildDoc({ components: [doubler()], patches: { src: { type: "splitter", inputs: { value: 5 } }, dbl: { type: "component", component: "doubler", muted: true, inputs: { x: { link: "src.output" } } } } }),
    );
    rt.step();
    expect(rt.getValue("dbl.y")).toBe(5);
  });

  it("an instance of a missing component raises an issue and readers use their defaults", () => {
    const doc = structuredClone(
      buildDoc({ components: [doubler()], patches: { dbl: { type: "component", component: "doubler" }, out: { type: "multiply", inputs: { a: { link: "dbl.y" }, b: 10 } } } }),
    );
    doc.components.main!.patches.dbl!.component = "nope";
    const rt = createTestRuntime(doc);
    rt.step();
    expect(rt.issues().map((i) => i.code)).toContain("component_not_found");
    expect(rt.getValue("out.output")).toBe(10);
  });

  it("nested instances inline recursively", () => {
    const quad: ComponentInput = {
      id: "quad",
      kind: "patchComponent",
      inputs: { x: { type: "number" } },
      outputs: { y: { type: "number", link: "d2.y" } },
      patches: {
        d1: { type: "component", component: "doubler", inputs: { x: { link: "$in.x" } } },
        d2: { type: "component", component: "doubler", inputs: { x: { link: "d1.y" } } },
      },
    };
    const rt = createTestRuntime(buildDoc({ components: [doubler(), quad], patches: { q: { type: "component", component: "quad", inputs: { x: 3 } } } }));
    rt.step();
    expect(rt.getValue("q.y")).toBe(12);
  });

  it("host feedback through an instance is an ordinary cycle with one frame of latency", () => {
    const rt = createTestRuntime(
      buildDoc({
        components: [doubler()],
        patches: {
          acc: { type: "add", inputs: { value1: { link: "dbl.y" }, value2: 1 } },
          dbl: { type: "component", component: "doubler", inputs: { x: { link: "acc.output" } } },
        },
      }),
    );
    expect(steps(rt, 3, "acc.output")).toEqual([1, 3, 7]);
  });
});

describe("components: layer components", () => {
  const card: ComponentInput = {
    id: "card",
    kind: "layerComponent",
    size: [200, 100],
    inputs: { title: { type: "text", default: "Untitled" } },
    outputs: { on: { type: "boolean", link: "toggle.on" } },
    layers: [
      { id: "button", type: "rectangle", name: "Button", props: { size: [200, 100] } },
      { id: "label", type: "text", name: "Label", props: { text: { link: "$in.title" } } },
    ],
    patches: {
      touch: { type: "interaction", inputs: { layer: { layer: "button" } } },
      toggle: { type: "switch", inputs: { flip: { link: "touch.tap" } } },
    },
  };

  it("renders the component's layers as instanceId/innerId with published inputs as props", () => {
    const rt = createTestRuntime(buildDoc({ components: [card], layers: [{ id: "c1", type: "componentInstance", name: "Card", component: "card", props: { title: "Hello", position: [10, 20] } }] }));
    const frame = rt.step();
    const c1 = frame.roots[0]!;
    expect([c1.key, c1.width, c1.height, c1.props.title]).toEqual(["c1", 200, 100, "Hello"]);
    expect(c1.children.map((c) => c.key)).toEqual(["c1/button", "c1/label"]);
    const label = c1.children[1]!;
    expect(label.props.text).toBe("Hello");
    expect(label.parentKey).toBe("c1");
    expect([label.worldTransform[12], label.worldTransform[13]]).toEqual([10, 20]);
  });

  it("taps inside an instance drive its own patches; hosts read outputs as @instance.key", () => {
    const rt = createTestRuntime(buildDoc({ components: [card], layers: [{ id: "c1", type: "componentInstance", name: "Card", component: "card", props: {} }] }));
    runFrames(rt, 1);
    expect(rt.getValue("@c1.on")).toBe(false);
    runFrames(rt, 2, tap(50, 50));
    expect(rt.getValue("@c1.on")).toBe(true);
  });

  it("loops on published inputs or common props replicate the instance as instance#n/innerId", () => {
    const rt = createTestRuntime(
      buildDoc({
        components: [card],
        layers: [{ id: "c1", type: "componentInstance", name: "Card", component: "card", props: { title: { link: "names.output" }, position: { link: "pos.output" } } }],
        patches: {
          names: { type: "splitter", typeParam: "text", inputs: { value: { loop: ["a", "b"] } } },
          pos: { type: "splitter", typeParam: "point", inputs: { value: { loop: [[0, 0], [0, 200]] } } },
        },
      }),
    );
    const frame = rt.step();
    expect(frame.roots.map((r) => r.key)).toEqual(["c1#0", "c1#1"]);
    expect(frame.roots.map((r) => r.children[1]!.key)).toEqual(["c1#0/label", "c1#1/label"]);
    expect(frame.roots.map((r) => r.children[1]!.props.text)).toEqual(["a", "b"]);
    runFrames(rt, 1);
    runFrames(rt, 2, tap(50, 250));
    expect(items(rt.getRawValue("@c1.on"))).toEqual([false, true]);
  });
});
