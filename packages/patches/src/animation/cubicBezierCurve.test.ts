import type { Loop } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { cubicBezierCurve } from "./cubicBezierCurve.ts";
import { cubicBezierEase } from "./shared.ts";

const shape = (inputs: Record<string, unknown>) => {
  const h = createPatchHarness(cubicBezierCurve, { inputs });
  const frame = h.step();
  return { output: frame.outputs.output as number, curvePoint: frame.outputs.curvePoint, logs: h.logs };
};

describe("cubicBezierCurve", () => {
  it.each([
    [0.25, 0.129162],
    [0.5, 0.5],
    [0.75, 0.870838],
    [-0.5, 0],
    [1.5, 1],
  ])("defaults to CSS ease-in-out: %d → %d", (progress, expected) => {
    expect(shape({ progress }).output).toBeCloseTo(expected, 5);
  });

  it("matches the catalog golden values for other control points", () => {
    expect(shape({ progress: 0.25, control1X: 0.2, control1Y: 0, control2X: 0, control2Y: 1 }).output).toBeCloseTo(0.60722, 5);
    expect(shape({ progress: 0.5, control1X: 0.2, control1Y: 0, control2X: 0, control2Y: 1 }).output).toBeCloseTo(0.877834, 5);
    expect(shape({ progress: 0.5, control1X: 0.34, control1Y: 1.56, control2X: 0.64, control2Y: 1 }).output).toBeCloseTo(1.087401, 5);
  });

  it("outputs [progress, eased progress] as Curve Point", () => {
    const result = shape({ progress: 0.25 });
    expect((result.curvePoint as number[])[0]).toBe(0.25);
    expect((result.curvePoint as number[])[1]).toBe(result.output);
  });

  it("extends in straight lines toward the control points outside 0–1", () => {
    // Below 0 the slope is y1 / x1; above 1 it's (y2 − 1) / (x2 − 1).
    expect(cubicBezierEase(0.5, 0.25, 0.8, 1.2, -2)).toBeCloseTo(-1, 12);
    expect(cubicBezierEase(0.5, 0.25, 0.8, 1.2, 3)).toBeCloseTo(1 + ((1.2 - 1) / (0.8 - 1)) * 2, 12);
    // x1 = 0 falls back to the second control point, and both on the axis give 0.
    expect(cubicBezierEase(0, 0.5, 0.5, 1, -1)).toBeCloseTo(-2, 12);
    expect(cubicBezierEase(0, 0.5, 0, 1, -1)).toBe(-0);
    expect(cubicBezierEase(1, 0.5, 1, 1, 2)).toBe(1);
  });

  it("gives Linear for control points on the diagonal", () => {
    expect(shape({ progress: 0.3, control1X: 0, control1Y: 0, control2X: 1, control2Y: 1 }).output).toBeCloseTo(0.3, 12);
  });

  it("clamps Control X values to 0–1", () => {
    expect(shape({ progress: 0.4, control1X: -2, control2X: 3 }).output).toBe(shape({ progress: 0.4, control1X: 0, control2X: 1 }).output);
  });

  it("replaces non-finite controls with the defaults and warns once", () => {
    const result = shape({ progress: 0.25, control1Y: Number.NaN });
    expect(result.output).toBeCloseTo(0.129162, 5);
    expect(result.logs).toHaveLength(1);
  });

  it("outputs 0 for a non-finite Progress", () => {
    const result = shape({ progress: Number.NEGATIVE_INFINITY });
    expect(result.output).toBe(0);
    expect(result.curvePoint).toEqual([0, 0]);
  });

  it("plots looped progress as looped curve points", () => {
    const h = createPatchHarness(cubicBezierCurve, { inputs: { progress: loopOf([0, 0.5, 1]) } });
    const points = (h.step().outputs.curvePoint as Loop<number[]>).items;
    expect(points).toEqual([
      [0, 0],
      [0.5, 0.5],
      [1, 1],
    ]);
  });
});
