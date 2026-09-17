import { LAYER_TYPE_MAP, formatColor, resolveNodePorts } from "@sonobe/core";
import type { GradientValue } from "@sonobe/core";
import { createEngineRegistry } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness } from "../infra/index.ts";
import { createPatchRegistry } from "../registry.ts";
import { MAX_GRADIENT_STOPS, gradientBuilderPatch, gradientStopCount, gradientStopPorts } from "./gradientBuilder.ts";
import type { BuiltGradient } from "./gradientBuilder.ts";

const gradientOf = (result: ReturnType<typeof runPatch>, frame = 0) => result.frames[frame]!.outputs.gradient as BuiltGradient;
const summary = (g: GradientValue) => g.stops.map((s) => [s.offset, formatColor(s.color)]);

describe("gradientBuilder ports", () => {
  it("clamps the stop count to 1…32 with a default of 2", () => {
    expect(gradientStopCount({})).toBe(2);
    expect(gradientStopCount({ inputCount: 0 })).toBe(1);
    expect(gradientStopCount({ inputCount: 3.4 })).toBe(3);
    expect(gradientStopCount({ inputCount: 99 })).toBe(MAX_GRADIENT_STOPS);
    expect(gradientStopCount({ inputCount: Number.NaN })).toBe(2);
  });

  it("appends evenly spaced stops and white-to-black grays", () => {
    const three = gradientStopPorts(3);
    expect(three.map((p) => [p.key, p.default])).toEqual([
      ["stop1", 0],
      ["color1", "#FFFFFFFF"],
      ["stop2", 0.5],
      ["color2", "#808080FF"],
      ["stop3", 1],
      ["color3", "#000000FF"],
    ]);
    expect(three[0]).toMatchObject({ name: "Stop 1", type: "number", subtype: "progress", min: 0, max: 1, step: 0.01, description: "Where Color 1 sits along the gradient: 0 at Start, 1 at End." });
    expect(three[1]).toMatchObject({ name: "Color 1", type: "color", description: "The color at Stop 1." });
    expect(gradientStopPorts(1).map((p) => p.default)).toEqual([0, "#FFFFFFFF"]);
  });

  it("resolves through core after the static inputs", () => {
    const registry = createEngineRegistry([gradientBuilderPatch]);
    const doc = { project: { formatVersion: 1, name: "t", root: "main", device: { preset: "custom" } }, components: {}, scripts: {}, assets: {} };
    const ports = resolveNodePorts(doc, { type: "gradientBuilder", inputCount: 3, inputs: {}, ui: { x: 0, y: 0 } }, registry)!;
    expect(ports.inputs.map((p) => p.key)).toEqual(["type", "start", "end", "ratio", "stop1", "color1", "stop2", "color2", "stop3", "color3"]);
    expect(ports.outputs.map((p) => p.key)).toEqual(["gradient"]);
    expect(createPatchRegistry().definitions.get("gradientBuilder")!.dynamicPorts).toBeTypeOf("function");
  });
});

describe("gradientBuilder", () => {
  it("matches the Gradient layer default with every input at its default", () => {
    const g = gradientOf(runPatch(gradientBuilderPatch, [{}]));
    expect(g).toEqual({ kind: "linear", stops: [{ offset: 0, color: { r: 1, g: 1, b: 1, a: 1 } }, { offset: 1, color: { r: 0, g: 0, b: 0, a: 1 } }], start: [0.5, 0], end: [0.5, 1] });
    expect(g).toEqual(LAYER_TYPE_MAP.get("gradient")!.props.find((p) => p.key === "gradient")!.default);
  });

  it("sorts stops by position, keeping port order for ties", () => {
    const sorted = gradientOf(runPatch(gradientBuilderPatch, [{ stop1: 0.8, color1: "#FF0000FF", stop2: 0.2, color2: "#0000FFFF" }]));
    expect(summary(sorted)).toEqual([
      [0.2, "#0000FFFF"],
      [0.8, "#FF0000FF"],
    ]);
    const ties = gradientOf(runPatch(gradientBuilderPatch, [{ stop1: 0.5, color1: "#FF0000FF", stop2: 0.5, color2: "#00FF00FF", stop3: 0.5, color3: "#0000FFFF" }], { inputCount: 3 }));
    expect(summary(ties).map(([, c]) => c)).toEqual(["#FF0000FF", "#00FF00FF", "#0000FFFF"]);
  });

  it("builds N stops from inputCount with dynamic defaults", () => {
    const sunset = gradientOf(runPatch(gradientBuilderPatch, [{ stop2: 0.55, color1: "#FF5F6DFF", color2: "#FFC371FF", color3: "#47CACCFF" }], { inputCount: 3 }));
    expect(summary(sunset)).toEqual([
      [0, "#FF5F6DFF"],
      [0.55, "#FFC371FF"],
      [1, "#47CACCFF"],
    ]);
    const single = gradientOf(runPatch(gradientBuilderPatch, [{ color1: "#5B5FEFFF" }], { inputCount: 1 }));
    expect(summary(single)).toEqual([[0, "#5B5FEFFF"]]);
    const defaults = gradientOf(runPatch(gradientBuilderPatch, [{}], { inputCount: 3 }));
    expect(summary(defaults)).toEqual([
      [0, "#FFFFFFFF"],
      [0.5, "#808080FF"],
      [1, "#000000FF"],
    ]);
  });

  it("leaves offsets, Start, and End unclamped and clamps stop colors", () => {
    const g = gradientOf(runPatch(gradientBuilderPatch, [{ stop1: -0.3, stop2: 1.6, color2: { r: 2, g: -1, b: 0.5, a: 4 }, start: [-0.5, 0.5], end: [1.5, 0.5] }]));
    expect(g.stops.map((s) => s.offset)).toEqual([-0.3, 1.6]);
    expect(g.stops[1]!.color).toEqual({ r: 1, g: 0, b: 0.5, a: 1 });
    expect(g.start).toEqual([-0.5, 0.5]);
    expect(g.end).toEqual([1.5, 0.5]);
  });

  it("adds Ratio only to stretched radial gradients", () => {
    expect(gradientOf(runPatch(gradientBuilderPatch, [{ type: "radial", ratio: 2 }])).ratio).toBe(2);
    expect("ratio" in gradientOf(runPatch(gradientBuilderPatch, [{ type: "radial" }]))).toBe(false);
    expect("ratio" in gradientOf(runPatch(gradientBuilderPatch, [{ type: "linear", ratio: 2 }]))).toBe(false);
    expect(gradientOf(runPatch(gradientBuilderPatch, [{ type: "angular" }])).kind).toBe("angular");
  });

  it("falls back for unknown types, bad ratios, and non-finite numbers, warning once each", () => {
    const result = runPatch(gradientBuilderPatch, [{ type: "conic", ratio: -1, stop1: Number.NaN, start: [Number.NaN, 0.25] }, { type: "radial", ratio: 0 }]);
    const g = gradientOf(result);
    expect(g.kind).toBe("linear");
    expect(g.stops[0]!.offset).toBe(0);
    expect(g.start).toEqual([0, 0.25]);
    expect("ratio" in gradientOf(result, 1)).toBe(false);
    // Point → anchor coercion already reads a NaN component as 0, so Start never warns here.
    expect(result.logs.map((l) => l.args[0])).toEqual([
      'Gradient Builder: "conic" isn\'t a gradient type, so it draws Linear.',
      "Gradient Builder: Ratio must be above 0, so it counts as 1.",
      "Gradient Builder: Stop 1 isn't a finite number, so it counts as 0.",
    ]);
  });

  it("produces one gradient per loop index", () => {
    const result = runPatch(gradientBuilderPatch, [{ color1: { loop: ["#FF0000FF", "#00FF00FF"] } }]);
    const loop = result.frames[0]!.outputs.gradient as unknown as { items: GradientValue[] };
    expect(loop.items.map((g) => formatColor(g.stops[0]!.color))).toEqual(["#FF0000FF", "#00FF00FF"]);
    expect(loop.items.every((g) => g.stops.length === 2)).toBe(true);
  });

  it("uses dynamic defaults in the patch harness, which has no dynamic ports", () => {
    const g = createPatchHarness(gradientBuilderPatch, { inputCount: 3 }).step().outputs.gradient as GradientValue;
    expect(summary(g)).toEqual([
      [0, "#FFFFFFFF"],
      [0.5, "#808080FF"],
      [1, "#000000FF"],
    ]);
  });
});
