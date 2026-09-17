import type { Color } from "@sonobe/core";
import { runPatch } from "@sonobe/engine/testing";
import type { RunPatchOptions } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { loopOf } from "../infra/index.ts";
import { keyframeCount, keyframePorts, keyframes } from "./keyframes.ts";

/** Evaluate Keyframes once per entry of `frames` through the runtime evaluator (which honors dynamic ports). */
const run = (frames: Record<string, unknown>[], options: RunPatchOptions = {}) => runPatch(keyframes, frames, options);
const outputsOf = (frames: Record<string, unknown>[], options: RunPatchOptions = {}) => run(frames, options).frames.map((f) => f.outputs.output);

describe("keyframes", () => {
  it("blends between neighboring keyframes and holds past the ends", () => {
    expect(outputsOf([{ progress: 0.25 }, { progress: 0.5 }, { progress: 0.75 }, { progress: -1 }, { progress: 1.5 }])).toEqual([0.5, 1, 0.5, 0, 0]);
  });

  it("continues the end segments with Extrapolate", () => {
    expect(outputsOf([{ progress: 1.5, extrapolate: true }, { progress: -1 }])).toEqual([-1, -2]);
  });

  it("eases within each segment", () => {
    expect(outputsOf([{ progress: 0.125, curve: "quadraticInOut" }])[0] as number).toBeCloseTo(0.125, 12);
  });

  it("jumps at equal stops, and the later keyframe wins at the shared stop", () => {
    expect(outputsOf([{ progress: 0.5, stop3: 0.5, value3: 2 }, { progress: 0.49 }])).toEqual([2, 0.98]);
  });

  it("raises a misordered stop to the previous stop", () => {
    const out = outputsOf([{ progress: 0.8, stop2: 0.8, stop3: 0.4, value3: 2 }, { progress: 0.6 }]);
    expect(out[0]).toBe(2);
    expect(out[1] as number).toBeCloseTo(0.75, 12);
  });

  it("uses the node's keyframe count", () => {
    const out = outputsOf([{ progress: 5 / 6 }, { progress: 1 }], { inputCount: 4 });
    expect(out[0] as number).toBeCloseTo(0.5, 12);
    expect(out[1]).toBe(1);
  });

  it("defaults colors to alternating white and black", () => {
    const [mid] = outputsOf([{ progress: 0.25 }], { typeParam: "color" }) as Color[];
    expect(mid!.r).toBeCloseTo(0.5, 12);
    expect(mid!.a).toBe(1);
  });

  it("works per component for points", () => {
    expect(outputsOf([{ progress: 0.75, value1: [0, 0], value2: [100, 50], value3: [0, 200] }], { typeParam: "point" })).toEqual([[50, 125]]);
  });

  it("evaluates loops per index for staggered progress", () => {
    expect(outputsOf([{ progress: loopOf([0, 0.25, 0.5]) }])).toEqual([loopOf([0, 0.5, 1])]);
  });

  it("outputs the first keyframe for a non-finite Progress and warns", () => {
    const result = run([{ progress: Number.NaN, value1: 3 }]);
    expect(result.frames[0]!.outputs.output).toBe(3);
    expect(result.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("passes Value 1 through while muted", () => {
    expect(outputsOf([{ progress: 0.5, value1: 9 }], { muted: true })).toEqual([9]);
  });

  describe("dynamic ports", () => {
    it("adds evenly spaced stops and alternating values", () => {
      const { inputs, outputs } = keyframePorts({ type: "keyframes", inputs: {}, ui: { x: 0, y: 0 } });
      expect(outputs).toEqual([]);
      expect(inputs.map((p) => p.key)).toEqual(["stop1", "value1", "stop2", "value2", "stop3", "value3"]);
      expect(inputs.filter((p) => p.key.startsWith("stop")).map((p) => p.default)).toEqual([0, 0.5, 1]);
      expect(inputs.filter((p) => p.key.startsWith("value")).map((p) => p.default)).toEqual([0, 1, 0]);
      expect(inputs.find((p) => p.key === "value1")!.type).toBe("variant");
    });

    it("uses color defaults for the color variant and zero values for other variants", () => {
      const color = keyframePorts({ type: "keyframes", typeParam: "color", inputCount: 2, inputs: {}, ui: { x: 0, y: 0 } });
      expect(color.inputs.filter((p) => p.key.startsWith("value")).map((p) => p.default)).toEqual(["#FFFFFFFF", "#000000FF"]);
      const point = keyframePorts({ type: "keyframes", typeParam: "point", inputs: {}, ui: { x: 0, y: 0 } });
      expect(point.inputs.find((p) => p.key === "value2")!.default).toBeUndefined();
    });

    it("clamps the keyframe count to 2–32", () => {
      expect(keyframeCount(undefined)).toBe(3);
      expect(keyframeCount(1)).toBe(2);
      expect(keyframeCount(40)).toBe(32);
      expect(keyframeCount(4.4)).toBe(4);
      expect(keyframePorts({ type: "keyframes", inputCount: 5, inputs: {}, ui: { x: 0, y: 0 } }).inputs.map((p) => p.default).filter((d) => d !== undefined)).toEqual([
        0, 0, 0.25, 1, 0.5, 0, 0.75, 1, 1, 0,
      ]);
    });
  });
});
