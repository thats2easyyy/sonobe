import type { Color, GradientValue } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { isInterpolable, lerp, lerpColor, lerpComponents, lerpGradient, lerpValue, sampleGradient } from "./lerp.ts";

const white: Color = { r: 1, g: 1, b: 1, a: 1 };
const black: Color = { r: 0, g: 0, b: 0, a: 1 };
const red: Color = { r: 1, g: 0, b: 0, a: 1 };
const green: Color = { r: 0, g: 1, b: 0, a: 1 };
const blue: Color = { r: 0, g: 0, b: 1, a: 1 };

describe("lerp", () => {
  it("interpolates numbers with an exact start", () => {
    expect(lerp(0.1, 0.3, 0)).toBe(0.1);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 1.5)).toBe(15);
    expect(lerpValue(3, 9, Number.NaN, "number")).toBe(3);
    expect(isInterpolable("color")).toBe(true);
    expect(isInterpolable("text")).toBe(false);
  });

  it("blends vectors component-wise", () => {
    expect(lerpValue([0, 0], [100, 200], 0.25, "point")).toEqual([25, 50]);
    expect(lerpValue(0, [10, 20], 0.5, "size")).toEqual([5, 10]);
    expect(lerpValue([0, 0, 0], [2, 4, 6], 0.5, "point3d")).toEqual([1, 2, 3]);
    expect(lerpValue([0, 0], [1, 1], 2, "anchor")).toEqual([2, 2]);
    expect(lerpComponents([1], [3, 5], 0.5)).toEqual([2, 2.5]);
  });

  it("blends colors in straight RGBA and clamps channels", () => {
    expect(lerpValue(white, black, 0.5, "color")).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 });
    expect(lerpValue("#FFFFFFFF", "#000000FF", 1.5, "color")).toEqual(black);
    expect(lerpColor({ r: 1, g: 0, b: 0, a: 0 }, blue, 0.5)).toEqual({ r: 0.5, g: 0, b: 0.5, a: 0.5 });
  });

  it("steps between values that can't blend", () => {
    expect(lerpValue("a", "b", 0.4, "text")).toBe("a");
    expect(lerpValue("a", "b", 0.5, "text")).toBe("b");
    expect(lerpValue(false, true, 0.9, "boolean")).toBe(true);
  });

  it("blends gradients", () => {
    const a: GradientValue = { kind: "linear", stops: [{ offset: 0, color: white }, { offset: 1, color: black }], start: [0.5, 0], end: [0.5, 1] };
    const b: GradientValue = { kind: "radial", stops: [{ offset: 0, color: red }, { offset: 1, color: blue }], start: [0, 0], end: [1, 1] };
    const mid = lerpValue(a, b, 0.5, "gradient") as GradientValue;
    expect(mid.kind).toBe("radial");
    expect(mid.start).toEqual([0.25, 0]);
    expect(mid.end).toEqual([0.75, 1]);
    expect(mid.stops[0]!.color).toEqual({ r: 1, g: 0.5, b: 0.5, a: 1 });
    expect(lerpGradient(a, b, 0.25)!.kind).toBe("linear");

    const three: GradientValue = { ...b, stops: [{ offset: 0, color: red }, { offset: 0.5, color: green }, { offset: 1, color: blue }] };
    expect(lerpGradient(a, three, 1)!.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
    expect(lerpGradient(a, three, 1)!.stops[1]!.color).toEqual(green);
    expect(lerpGradient(a, three, 0)!.stops[1]!.color).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 });
    expect(lerpGradient(null, b, 0.3)).toBe(b);
    expect(lerpGradient(a, undefined, 0.3)).toBe(a);
    expect(lerpGradient(null, null, 0.3)).toBeNull();
    expect(sampleGradient(a, -1)).toEqual(white);
    expect(sampleGradient(a, 2)).toEqual(black);
  });
});
