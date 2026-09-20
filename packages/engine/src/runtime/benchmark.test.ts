import { describe, expect, it } from "vitest";
import { buildDoc, createMockRegistry, createTestRuntime, defineMock, port, type PatchInput } from "../testing/index.ts";

/** Generous CI threshold; the budget target is < 4 ms per frame on a laptop. */
const THRESHOLD_MS = 12;

describe("runtime: performance", () => {
  it("evaluates 500 simple patches within the frame budget", () => {
    const patches: Record<string, PatchInput> = { p0: { type: "splitter", inputs: { value: 1 } } };
    for (let i = 1; i < 500; i++) patches[`p${i}`] = { type: "add", inputs: { value1: { link: `p${i - 1}.output` }, value2: 1 } };
    const rt = createTestRuntime(buildDoc({ patches }));
    for (let i = 0; i < 60; i++) rt.step();
    const frames = 300;
    const start = performance.now();
    for (let i = 0; i < frames; i++) rt.step();
    const msPerFrame = (performance.now() - start) / frames;
    expect(rt.getValue("p499.output")).toBe(500);
    expect(msPerFrame).toBeLessThan(THRESHOLD_MS);
  });

  it("replicates 1,000 tappable copies next to 20 empty lists within the frame budget", () => {
    // A patch that explains its empty output every frame keeps the empty-loop checks on: each empty
    // layer's trail is followed every frame.
    const nothing = defineMock({
      type: "nothing",
      name: "Nothing",
      inputs: [],
      outputs: [port("output", "number", { wholeLoop: true })],
      evaluate(ctx) {
        ctx.output("output", []);
        ctx.explainEmpty?.("it never has items");
      },
    });
    const reg = createMockRegistry([nothing]);
    const layers = [{ id: "row", type: "rectangle" as const, name: "Row", props: { opacity: { link: "rows.index" }, scale: { link: "grow.output" } } }];
    const patches: Record<string, PatchInput> = {
      rows: { type: "loop", inputs: { count: 1000 } },
      touch: { type: "interaction", inputs: { layer: { layer: "row" } } },
      toggle: { type: "switch", inputs: { flip: { link: "touch.tap" } } },
      grow: { type: "transition", inputs: { progress: { link: "toggle.on" }, start: 1, end: 1.1 } },
      none: { type: "nothing" },
    };
    for (let i = 0; i < 20; i++) {
      layers.push({ id: `empty${i}`, type: "rectangle", name: `Empty ${i}`, props: { opacity: { link: `none_${i}.output` }, scale: { link: `grow_${i}.output` } } } as never);
      patches[`none_${i}`] = { type: "splitter", inputs: { value: { link: "none.output" } } };
      patches[`touch_${i}`] = { type: "interaction", inputs: { layer: { layer: `empty${i}` } } };
      patches[`grow_${i}`] = { type: "transition", inputs: { progress: { link: `touch_${i}.down` } } };
    }
    const rt = createTestRuntime(buildDoc({ layers, patches }, reg), reg);
    for (let i = 0; i < 30; i++) rt.step();
    const frames = 120;
    const start = performance.now();
    for (let i = 0; i < frames; i++) rt.step();
    const msPerFrame = (performance.now() - start) / frames;
    expect(rt.scene().roots).toHaveLength(1000);
    expect(rt.issues().filter((i) => i.code === "empty_loop")).toHaveLength(20);
    expect(msPerFrame).toBeLessThan(THRESHOLD_MS);
  });

  it("repeats a layer 5,000 times through Repeat about as fast as through its own looped property", () => {
    const perFrame = (props: Record<string, unknown>) => {
      const rt = createTestRuntime(buildDoc({ layers: [{ id: "dot", type: "rectangle", name: "Dot", props: props as never }], patches: { rows: { type: "loop", inputs: { count: 5000 } } } }));
      for (let i = 0; i < 10; i++) rt.step();
      const frames = 40;
      const start = performance.now();
      for (let i = 0; i < frames; i++) rt.step();
      expect(rt.scene().roots).toHaveLength(5000);
      return (performance.now() - start) / frames;
    };
    const auto = perFrame({ opacity: { link: "rows.index" } });
    // Repeat reads the loop's length; copying the whole loop into every copy would cost 5,000² per frame.
    const repeat = perFrame({ repeat: { link: "rows.index" } });
    expect(repeat).toBeLessThan(Math.max(THRESHOLD_MS * 2, auto * 3));
  });
});
