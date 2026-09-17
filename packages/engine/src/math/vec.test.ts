import { describe, expect, it } from "vitest";
import { simplifyPolyline, toCssLinear } from "./polyline.ts";
import {
  add2,
  approxEqual,
  clamp,
  colorToVec4,
  distance2,
  finiteOr,
  formatNumber,
  length2,
  lerp,
  lerpVec,
  scale2,
  sub2,
  toVec2,
  toVec4,
  vec4ToColor,
} from "./vec.ts";

describe("vec helpers", () => {
  it("scalar helpers", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(lerp(50, 100, -0.5)).toBe(25);
    expect(lerp(50, 100, 2)).toBe(150);
    expect(approxEqual(0.1 + 0.2, 0.3)).toBe(true);
    expect(finiteOr(Number.NaN, 7)).toBe(7);
    expect(finiteOr("3", 7)).toBe(7);
  });

  it("2D vector helpers", () => {
    expect(add2([1, 2], [3, 4])).toEqual([4, 6]);
    expect(sub2([1, 2], [3, 4])).toEqual([-2, -2]);
    expect(scale2([1, -2], 3)).toEqual([3, -6]);
    expect(length2([3, 4])).toBe(5);
    expect(distance2([1, 1], [4, 5])).toBe(5);
    expect(lerpVec([0, 10], [10, 20, 30], 0.5)).toEqual([5, 15, 15]);
  });

  it("coerces runtime values", () => {
    expect(toVec2(4)).toEqual([4, 4]);
    expect(toVec2([1, 2, 3])).toEqual([1, 2]);
    expect(toVec2([Number.NaN, 2], [9, 9])).toEqual([9, 2]);
    expect(toVec2("nope", [1, 2])).toEqual([1, 2]);
    expect(toVec4(8)).toEqual([8, 8, 8, 8]);
    expect(toVec4([1, 2])).toEqual([1, 2, 1, 2]);
    expect(toVec4([1, 2, 3])).toEqual([1, 2, 3, 2]);
    expect(toVec4([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(toVec4(null)).toEqual([0, 0, 0, 0]);
  });

  it("color conversion", () => {
    expect(colorToVec4({ r: 0.1, g: 0.2, b: 0.3, a: 0.4 })).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(vec4ToColor([1.2, -0.1, 0.5, 1])).toEqual({ r: 1, g: 0, b: 0.5, a: 1 });
  });

  it("formatNumber", () => {
    expect(formatNumber(1.23456, 2)).toBe("1.23");
    expect(formatNumber(2, 4)).toBe("2");
    expect(formatNumber(-0.00001, 3)).toBe("0");
    expect(formatNumber(1e-7, 6)).toBe("0");
    expect(formatNumber(0.5, 3)).toBe("0.5");
    expect(formatNumber(Number.NaN)).toBe("0");
  });
});

describe("polyline", () => {
  it("collapses collinear points and keeps corners", () => {
    const line = Array.from({ length: 11 }, (_, i) => [i / 10, i / 10] as [number, number]);
    expect(simplifyPolyline(line, 0.001)).toEqual([
      [0, 0],
      [1, 1],
    ]);
    const corner: [number, number][] = [
      [0, 0],
      [0.25, 0.5],
      [0.5, 1],
      [0.75, 1],
      [1, 1],
    ];
    expect(simplifyPolyline(corner, 0.001)).toEqual([
      [0, 0],
      [0.5, 1],
      [1, 1],
    ]);
  });

  it("formats CSS linear()", () => {
    expect(
      toCssLinear([
        [0, 0],
        [0.3, 1.08],
        [1, 1],
      ]),
    ).toBe("linear(0, 1.08 30%, 1)");
    expect(toCssLinear([])).toBe("linear");
  });
});
