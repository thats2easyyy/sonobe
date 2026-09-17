import { describe, expect, it } from "vitest";
import { CURVE_KEYS, curveFunction, curveOrLinear, curveSlopes, ease, easeExtended, isKnownCurve } from "./curves.ts";

describe("curves", () => {
  it("knows every CURVE option", () => {
    expect(CURVE_KEYS).toHaveLength(13);
    for (const key of CURVE_KEYS) expect(isKnownCurve(key), key).toBe(true);
    expect(isKnownCurve("wobble")).toBe(false);
    expect(curveFunction("wobble")).toBeUndefined();
    expect(curveOrLinear("wobble")(0.3)).toBe(0.3);
  });

  it("eases with clamped progress", () => {
    expect(ease("quadraticInOut", 0.25)).toBe(0.125);
    expect(ease("sinusoidalOut", 1)).toBeCloseTo(1, 12);
    expect(ease("wobble", 0.4)).toBe(0.4);
    expect(ease("cubicIn", 2)).toBe(1);
  });

  it("extends curves along their tangents (Curve patch golden values)", () => {
    expect(easeExtended("quadraticInOut", 0.25)).toBe(0.125);
    expect(easeExtended("cubicOut", -0.5)).toBe(-1.5);
    expect(easeExtended("exponentialIn", 1.5)).toBeCloseTo(4.465736, 6);
    expect(easeExtended("quadraticInOut", 1.2)).toBe(1);
    expect(easeExtended("linear", 2)).toBe(2);
    expect(easeExtended("wobble", 3)).toBe(3);
    expect(easeExtended("cubicIn", Number.NaN)).toBe(0);
  });

  it("uses slopes that match the curves", () => {
    const h = 1e-6;
    for (const key of CURVE_KEYS) {
      const fn = curveFunction(key)!;
      const { start, end } = curveSlopes(key);
      expect(start, `${key} start`).toBeCloseTo((fn(2 * h) - fn(h)) / h, 3);
      expect(end, `${key} end`).toBeCloseTo((fn(1 - h) - fn(1 - 2 * h)) / h, 3);
    }
    expect(curveSlopes("backOut").end).toBeCloseTo(0, 3);
    expect(curveSlopes("wobble")).toEqual({ start: 1, end: 1 });
  });
});
