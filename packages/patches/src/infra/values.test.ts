import { describe, expect, it } from "vitest";
import { loopOf } from "./loops.ts";
import {
  allFinite,
  clamp,
  clamp01,
  componentCount,
  components,
  equalValues,
  finiteOr,
  fromComponents,
  isPlainObject,
  normalizeZero,
  positiveMod,
  sameComponents,
  toBool,
  toJson,
  toNumber,
  toText,
  whole,
  wholeInRange,
  zeroValue,
  zeros,
} from "./values.ts";

describe("reading values", () => {
  it("reads numbers", () => {
    expect(toNumber(3)).toBe(3);
    expect(toNumber(Number.NaN, 7)).toBe(7);
    expect(toNumber(Number.POSITIVE_INFINITY)).toBe(0);
    expect(toNumber("12.5")).toBe(12.5);
    expect(toNumber(true)).toBe(1);
    expect(toNumber([3, 4])).toBe(3);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined, 2)).toBe(2);
    expect(finiteOr("5", 1)).toBe(1);
    expect(finiteOr(-4, 1)).toBe(-4);
  });

  it("reads booleans and text", () => {
    expect(toBool(0.5)).toBe(true);
    expect(toBool(0)).toBe(false);
    expect(toBool("yes")).toBe(true);
    expect(toBool("off")).toBe(false);
    expect(toBool(null)).toBe(false);
    expect(toText(0.1 + 0.2)).toBe("0.3");
    expect(toText({ r: 1, g: 0, b: 0, a: 1 })).toBe("#FF0000FF");
    expect(toText(undefined)).toBe("");
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
  });

  it("clamps, wraps, and rounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(5, 10, 0)).toBe(10);
    expect(clamp(Number.NaN, 2, 3)).toBe(2);
    expect(clamp01(1.4)).toBe(1);
    expect(positiveMod(-1, 3)).toBe(2);
    expect(positiveMod(7, -3)).toBe(-2);
    expect(positiveMod(5.5, 2)).toBe(1.5);
    expect(positiveMod(4, 0)).toBe(0);
    expect(whole(2.9999999999999996)).toBe(3);
    expect(whole(Number.NaN)).toBeNaN();
    expect(wholeInRange(25, 0, 20)).toBe(20);
    expect(wholeInRange(Number.NaN, 1, 21)).toBe(1);
    expect(Object.is(normalizeZero(-0), 0)).toBe(true);
    expect(normalizeZero(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("zero values and components", () => {
  it("gives CONVENTIONS.md §8 zero values", () => {
    expect(zeroValue("number")).toBe(0);
    expect(zeroValue("boolean")).toBe(false);
    expect(zeroValue("text")).toBe("");
    expect(zeroValue("color")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(zeroValue("point3d")).toEqual([0, 0, 0]);
    expect(zeroValue("enum", [{ key: "smooth", name: "Smooth" }])).toBe("smooth");
    expect(zeroValue("enum")).toBe("");
    for (const type of ["json", "layer", "image", "gradient", "shape", "layerEffect", undefined]) expect(zeroValue(type)).toBeNull();
  });

  it("reads values as components", () => {
    expect(componentCount("color")).toBe(4);
    expect(componentCount("text")).toBeUndefined();
    expect(components(5, "point")).toEqual([5, 5]);
    expect(components([1], "point3d")).toEqual([1, 0, 0]);
    expect(components("#FF000080", "color")).toEqual([1, 0, 0, 128 / 255]);
    expect(components({ r: 0.2, g: 0.4, b: 0.6, a: 1 })).toEqual([0.2, 0.4, 0.6, 1]);
    expect(components(true, "number")).toEqual([1]);
    expect(components([Number.NaN, 2], "point")).toEqual([Number.NaN, 2]);
    expect(components([1, 2, 3])).toEqual([1, 2, 3]);
    expect(components(4)).toEqual([4]);
  });

  it("builds values from components", () => {
    expect(fromComponents([1.5, -0.2, 0.5, 2], "color")).toEqual({ r: 1, g: 0, b: 0.5, a: 1 });
    expect(fromComponents([2.7], "index")).toBe(2);
    expect(fromComponents([1], "point")).toEqual([1, 0]);
    expect(fromComponents([3], "number")).toBe(3);
    expect(fromComponents([1], "boolean")).toBe(true);
    expect(sameComponents([1, 2], [1, 2])).toBe(true);
    expect(sameComponents([1, 2], [1, 2, 3])).toBe(false);
    expect(allFinite([1, Number.NaN])).toBe(false);
    expect(zeros(3)).toEqual([0, 0, 0]);
  });
});

describe("JSON and equality", () => {
  it("converts runtime values to JSON", () => {
    let warned = 0;
    const json = toJson({ color: { r: 1, g: 0, b: 0, a: 1 }, list: [1, Number.NaN, undefined], loop: loopOf([true]), asset: { assetId: "a1" } }, () => warned++);
    expect(json).toEqual({ color: "#FF0000FF", list: [1, 0, null], loop: [true], asset: { assetId: "a1" } });
    expect(warned).toBe(1);
    expect(toJson(undefined)).toBeNull();
  });

  it("compares structurally", () => {
    expect(equalValues(0, -0)).toBe(true);
    expect(equalValues(Number.NaN, Number.NaN)).toBe(true);
    expect(equalValues([1, 2], [1, 2])).toBe(true);
    expect(equalValues([1, 2], [1, 2, 3])).toBe(false);
    expect(equalValues({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true);
    expect(equalValues({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(equalValues(loopOf([1]), loopOf([1]))).toBe(true);
    expect(equalValues("1", 1)).toBe(false);
    expect(equalValues(null, {})).toBe(false);
  });
});
