import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { checkRange, inRange } from "./inRange.ts";

const where = (value: number, min: number, max: number, bounds: string) => {
  const r = checkRange(value, min, max, bounds);
  expect([r.inRange, r.below, r.above].filter(Boolean)).toHaveLength(1);
  return r.inRange ? "in" : r.below ? "below" : "above";
};

describe("inRange", () => {
  it("includes both edges by default", () => {
    const h = createPatchHarness(inRange);
    expect(h.step().outputs).toEqual({ inRange: true, below: false, above: false });
    expect(h.step({ inputs: { value: -0.1 } }).outputs).toEqual({ inRange: false, below: true, above: false });
    expect(h.step({ inputs: { value: 1.1 } }).outputs).toEqual({ inRange: false, below: false, above: true });
  });

  it("counts excluded edges as below or above", () => {
    expect([where(0, 0, 1, "excludeBoth"), where(1, 0, 1, "excludeBoth"), where(0.5, 0, 1, "excludeBoth")]).toEqual(["below", "above", "in"]);
    expect([where(0, 0, 1, "includeMin"), where(1, 0, 1, "includeMin")]).toEqual(["in", "above"]);
    expect([where(0, 0, 1, "includeMax"), where(1, 0, 1, "includeMax")]).toEqual(["below", "in"]);
  });

  it("swaps min and max when they're reversed", () => {
    expect([where(5, 10, 0, "includeBoth"), where(-1, 10, 0, "includeBoth"), where(11, 10, 0, "includeBoth")]).toEqual(["in", "below", "above"]);
    expect(where(0, 10, 0, "includeMax")).toBe("below");
  });

  it("handles a zero-width range", () => {
    expect(where(5, 5, 5, "includeBoth")).toBe("in");
    expect(where(5, 5, 5, "includeMin")).toBe("above");
    expect(where(5, 5, 5, "includeMax")).toBe("below");
    expect(where(5, 5, 5, "excludeBoth")).toBe("below");
    expect(where(4, 5, 5, "includeBoth")).toBe("below");
  });

  it("treats unknown bounds as includeBoth and non-finite values as 0", () => {
    expect(where(1, 0, 1, "sideways")).toBe("in");
    expect(where(Number.NaN, 0, 1, "excludeBoth")).toBe("below");
  });

  it("evaluates once per loop index", () => {
    const h = createPatchHarness(inRange, { inputs: { value: loopOf([-1, 0.5, 2]) } });
    expect(h.step().outputs).toEqual({ inRange: loopOf([false, true, false]), below: loopOf([true, false, false]), above: loopOf([false, false, true]) });
  });

  it("outputs all false while muted", () => {
    expect(runPatch(inRange, [{ value: 0.5 }], { muted: true }).frames[0]!.outputs).toEqual({ inRange: false, below: false, above: false });
  });
});
