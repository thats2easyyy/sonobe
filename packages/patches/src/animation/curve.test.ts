import { describe, expect, it } from "vitest";
import { CURVE_KEYS, createPatchHarness, loopOf } from "../infra/index.ts";
import { curve } from "./curve.ts";

const shape = (curveKey: string, progress: unknown) => {
  const h = createPatchHarness(curve, { inputs: { curve: curveKey, progress } });
  return { output: h.step().outputs.output, logs: h.logs };
};

describe("curve", () => {
  it.each([
    ["quadraticInOut", 0.25, 0.125],
    ["cubicOut", -0.5, -1.5],
    ["exponentialIn", 1.5, 4.465736],
    ["quadraticInOut", 1.2, 1],
    ["linear", 2, 2],
    ["sinusoidalOut", 0.5, Math.SQRT1_2],
  ])("%s at %d → %d", (curveKey, progress, expected) => {
    expect(shape(curveKey, progress).output as number).toBeCloseTo(expected, 6);
  });

  it("keeps 0 at 0 and 1 at 1 for every curve and extends in straight lines", () => {
    for (const key of CURVE_KEYS) {
      expect(shape(key, 0).output as number).toBeCloseTo(0, 12);
      expect(shape(key, 1).output as number).toBeCloseTo(1, 12);
      const above = shape(key, 3).output as number;
      const nearEnd = shape(key, 2).output as number;
      expect(above - nearEnd).toBeCloseTo(nearEnd - 1, 9);
    }
  });

  it("uses Linear for an unknown curve and warns once", () => {
    const h = createPatchHarness(curve, { inputs: { curve: "springy", progress: 0.3 } });
    expect(h.step().outputs.output).toBe(0.3);
    h.run(3);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("outputs 0 for a non-finite Progress", () => {
    const result = shape("linear", Number.NaN);
    expect(result.output).toBe(0);
    expect(result.logs).toHaveLength(1);
  });

  it("evaluates loops per index", () => {
    expect(shape("linear", loopOf([0, 0.5, -1])).output).toEqual(loopOf([0, 0.5, -1]));
  });
});
