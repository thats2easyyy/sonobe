import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { arctangent, arctangentDegrees } from "./arctangent.ts";

describe("arctangent", () => {
  it("defaults to pointing right", () => {
    expect(createPatchHarness(arctangent).step().outputs.angle).toBe(0);
  });

  it("distinguishes all four quadrants, clockwise on screen", () => {
    expect(arctangentDegrees(1, 1)).toBe(45);
    expect(arctangentDegrees(1, 0)).toBe(90);
    expect(arctangentDegrees(1, -1)).toBe(135);
    expect(arctangentDegrees(-1, -1)).toBe(-135);
    expect(arctangentDegrees(-1, 0)).toBe(-90);
  });

  it("uses the range (-180, 180] and handles zero and infinite inputs", () => {
    expect(arctangentDegrees(0, -1)).toBe(180);
    expect(arctangentDegrees(-0, -1)).toBe(180);
    expect(Object.is(arctangentDegrees(-0, 1), 0)).toBe(true);
    expect(arctangentDegrees(0, 0)).toBe(0);
    expect(arctangentDegrees(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(45);
  });

  it("outputs 0 for NaN and warns once", () => {
    const h = createPatchHarness(arctangent, { inputs: { y: Number.NaN } });
    expect(h.run(2).outputs.angle).toBe(0);
    expect(h.logs).toHaveLength(1);
  });

  it("evaluates once per loop index", () => {
    expect(createPatchHarness(arctangent, { inputs: { y: loopOf([0, 1, 0]), x: loopOf([1, 0]) } }).step().outputs.angle).toEqual(loopOf([0, 90, 0]));
  });
});
