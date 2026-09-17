import { describe, expect, it } from "vitest";
import {
  addValues,
  arithmetic,
  createArithmeticReport,
  divideValues,
  foldArithmetic,
  maxValues,
  minValues,
  moduloValues,
  multiplyValues,
  subtractValues,
} from "./arithmetic.ts";

describe("typed arithmetic", () => {
  it("adds numbers, vectors, colors, and text", () => {
    expect(foldArithmetic("add", [1, 2, 3], "number")).toBe(6);
    expect(addValues([1, 2], 10, "point")).toEqual([11, 12]);
    expect(addValues([1, 2, 3], [1, 1, 1], "point3d")).toEqual([2, 3, 4]);
    expect(foldArithmetic("add", ["Page ", 3, " of 5"], "text")).toBe("Page 3 of 5");
    expect(addValues({ r: 0.5, g: 0.5, b: 0, a: 1 }, { r: 0.75, g: 0, b: 0.25, a: 1 }, "color")).toEqual({ r: 1, g: 0.5, b: 0.25, a: 1 });
    expect(addValues(2, 3)).toBe(5);
    expect(addValues([1, 2], [3, 4])).toEqual([4, 6]);
    expect(addValues(true, 1, "boolean")).toBe(2);
  });

  it("folds left", () => {
    expect(foldArithmetic("subtract", [10, 3, 2])).toBe(5);
    expect(foldArithmetic("multiply", [[2, 3], [4, 5]], "point")).toEqual([8, 15]);
    expect(foldArithmetic("divide", [100, 5, 2])).toBe(10);
    expect(arithmetic("max", 1, 9)).toBe(9);
    expect(foldArithmetic("add", [], "size")).toEqual([0, 0]);
  });

  it("gives 0 for zero divisors and reports the first one", () => {
    const report = createArithmeticReport();
    expect(divideValues([10, 10], [0, 2], "point", report)).toEqual([0, 5]);
    expect(report).toEqual({ nonFinite: false, zeroDivisor: 1 });
    const chain = createArithmeticReport();
    expect(foldArithmetic("divide", [10, 4, 0, 0], "number", chain)).toBe(0);
    expect(chain.zeroDivisor).toBe(2);
    const mod = createArithmeticReport();
    expect(moduloValues(7, 0, "number", mod)).toBe(0);
    expect(mod.zeroDivisor).toBe(1);
  });

  it("uses floored modulo", () => {
    expect(moduloValues(7, 3)).toBe(1);
    expect(moduloValues(-1, 3)).toBe(2);
    expect(moduloValues(7, -3)).toBe(-2);
    expect(moduloValues(5.5, 2)).toBe(1.5);
    expect(moduloValues(-1e-17, 3)).toBe(0);
    expect(Object.is(moduloValues(-3, 3), 0)).toBe(true);
  });

  it("picks components independently for min and max", () => {
    expect(minValues([10, 50], [30, 20], "point")).toEqual([10, 20]);
    expect(maxValues([10, 50], [30, 20], "point")).toEqual([30, 50]);
    expect(foldArithmetic("min", [3, 1, 2])).toBe(1);
  });

  it("turns non-finite results and -0 into 0", () => {
    const report = createArithmeticReport();
    expect(multiplyValues(1e308, 10, "number", report)).toBe(0);
    expect(report.nonFinite).toBe(true);
    expect(Object.is(multiplyValues(-1, 0), 0)).toBe(true);
  });

  it("keeps the first value for non-add ops on text", () => {
    expect(subtractValues("abc", "b", "text")).toBe("abc");
  });
});
