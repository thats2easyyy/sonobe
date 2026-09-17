import { describe, expect, it } from "vitest";
import {
  canConnect,
  coerce,
  decodeInput,
  defaultForPort,
  defaultValue,
  encodeValue,
  formatColor,
  formatNumber,
  isDecodedLoop,
  isInputValue,
  normalizeColor,
  parseColor,
  roundNumber,
  VALUE_TYPES,
} from "./values.ts";
import type { GradientValue } from "./types.ts";

describe("colors", () => {
  it("parses hex forms", () => {
    expect(parseColor("#F00")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseColor("#00ff00")).toEqual({ r: 0, g: 1, b: 0, a: 1 });
    expect(parseColor("#0000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor("#FF000080")!.a).toBeCloseTo(128 / 255);
  });

  it("parses rgb() and rgba() with numbers and percentages", () => {
    expect(parseColor("rgba(255, 128, 0, 0.5)")).toEqual({ r: 1, g: 128 / 255, b: 0, a: 0.5 });
    expect(parseColor("rgb(100% 0% 0%)")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseColor("rgb(0 0 0 / 50%)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });

  it("rejects text that isn't a color", () => {
    for (const s of ["", "#12", "#GGGGGG", "rgb(1, 2)", "blurple", "#1234567"]) expect(parseColor(s)).toBeUndefined();
  });

  it("formats #RRGGBBAA and round-trips", () => {
    expect(formatColor({ r: 1, g: 0.5, b: 0, a: 1 })).toBe("#FF8000FF");
    for (const hex of ["#12345678", "#FFFFFFFF", "#00000000", "#ABCDEF01"]) expect(formatColor(parseColor(hex)!)).toBe(hex);
    expect(normalizeColor("white")).toBe("#FFFFFFFF");
    expect(normalizeColor("#abc")).toBe("#AABBCCFF");
    expect(normalizeColor("nope")).toBeUndefined();
  });
});

describe("numbers", () => {
  it("rounds to 6 decimals without -0", () => {
    expect(roundNumber(1.23456789)).toBe(1.234568);
    expect(Object.is(roundNumber(-0), 0)).toBe(true);
    expect(Object.is(roundNumber(-0.0000001), 0)).toBe(true);
    expect(roundNumber(Number.NaN)).toBe(0);
    expect(formatNumber(2.5000000001)).toBe("2.5");
  });
});

describe("defaults", () => {
  it("has a default for every value type", () => {
    for (const t of VALUE_TYPES) expect(() => defaultValue(t)).not.toThrow();
    expect(defaultValue("point3d")).toEqual([0, 0, 0]);
    expect(defaultValue("color")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(defaultValue("layer")).toBeNull();
    expect(defaultValue("transform")).toHaveLength(16);
  });

  it("uses port defaults, first enum options, and decodes spec colors", () => {
    expect(defaultForPort({ type: "number", default: 5 })).toBe(5);
    expect(defaultForPort({ type: "enum", enumOptions: [{ key: "row" }, { key: "column" }] })).toBe("row");
    expect(defaultForPort({ type: "color", default: "#FF0000FF" })).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(defaultForPort({ type: "text" })).toBe("");
  });
});

describe("decodeInput", () => {
  it("decodes literals by port type", () => {
    expect(decodeInput(3, "number")).toBe(3);
    expect(decodeInput("#FF0000FF", "color")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(decodeInput([16, 120], "point")).toEqual([16, 120]);
    expect(decodeInput(2, "point")).toEqual([2, 2]);
    expect(decodeInput("row", "enum")).toBe("row");
    expect(decodeInput("https://x.test/a.png", "image")).toEqual({ url: "https://x.test/a.png" });
    expect(decodeInput(null, "number")).toBe(0);
    expect(decodeInput(undefined, "boolean")).toBe(false);
  });

  it("decodes wrappers", () => {
    expect(decodeInput({ layer: "card" }, "layer")).toEqual({ layerId: "card" });
    expect(decodeInput({ asset: "photo" }, "image")).toEqual({ assetId: "photo" });
    expect(decodeInput({ json: { a: [1, 2] } }, "json")).toEqual({ a: [1, 2] });
    expect(decodeInput({ json: { x: 3, y: 4 } }, "point")).toEqual([3, 4]);
    expect(decodeInput({ link: "pop.output" }, "number")).toBeUndefined();
    const loop = decodeInput({ loop: ["#FF0000FF", "#00FF00FF"] }, "color");
    expect(isDecodedLoop(loop)).toBe(true);
    expect(loop).toEqual({ loop: true, items: [{ r: 1, g: 0, b: 0, a: 1 }, { r: 0, g: 1, b: 0, a: 1 }] });
    const g = decodeInput({ gradient: { kind: "linear", stops: [[0, "#FFFFFFFF"], [1, "#000000FF"]], start: [0.5, 0], end: [0.5, 1] } }, "gradient") as GradientValue;
    expect(g.stops[1]!.color).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });
});

describe("encodeValue", () => {
  it("encodes runtime values as canonical literals", () => {
    expect(encodeValue({ r: 1, g: 0, b: 0, a: 1 }, "color")).toBe("#FF0000FF");
    expect(encodeValue([1, 2], "point")).toEqual([1, 2]);
    expect(encodeValue(1, "size")).toEqual([1, 1]);
    expect(encodeValue({ layerId: "card" }, "layer")).toEqual({ layer: "card" });
    expect(encodeValue({ assetId: "a1" }, "image")).toEqual({ asset: "a1" });
    expect(encodeValue({ url: "https://x.test" }, "video")).toBe("https://x.test");
    expect(encodeValue({ a: 1 }, "json")).toEqual({ json: { a: 1 } });
    expect(encodeValue(true, "pulse")).toBeNull();
    expect(encodeValue({ loop: true, items: [1, 2, 3] }, "number")).toEqual({ loop: [1, 2, 3] });
    expect(encodeValue({ path: "M0 0" }, "shape")).toBe("M0 0");
  });

  it("round-trips through decodeInput", () => {
    const cases: [unknown, Parameters<typeof decodeInput>[1]][] = [
      [{ r: 0.2, g: 0.4, b: 0.6, a: 1 }, "color"],
      [[1, 2, 3], "point3d"],
      [{ layerId: "x" }, "layer"],
      [{ kind: "radial", stops: [{ offset: 0, color: { r: 1, g: 1, b: 1, a: 1 } }], start: [0.5, 0.5], end: [1, 1] }, "gradient"],
      ["hello", "text"],
    ];
    for (const [value, type] of cases) {
      const decoded = decodeInput(encodeValue(value, type), type);
      if (type === "color") {
        const c = decoded as { r: number };
        expect(c.r).toBeCloseTo(0.2, 2);
      } else expect(decoded).toEqual(value);
    }
  });
});

describe("coerce", () => {
  it("follows the coercion table", () => {
    expect(coerce(0.5, "number", "boolean")).toBe(true);
    expect(coerce(0, "number", "boolean")).toBe(false);
    expect(coerce(-1, "number", "boolean")).toBe(false);
    expect(coerce(true, "boolean", "number")).toBe(1);
    expect(coerce(3, "number", "point3d")).toEqual([3, 3, 3]);
    expect(coerce([7, 8], "point", "number")).toBe(7);
    expect(coerce(1.5, "number", "text")).toBe("1.5");
    expect(coerce("2.25", "text", "number")).toBe(2.25);
    expect(coerce("abc", "text", "number")).toBe(0);
    expect(coerce({ r: 1, g: 0, b: 0.5, a: 1 }, "color", "point4d")).toEqual([1, 0, 0.5, 1]);
    expect(coerce([0, 1, 0, 1], "point4d", "color")).toEqual({ r: 0, g: 1, b: 0, a: 1 });
    expect(coerce(true, "boolean", "pulse")).toBe(true);
    expect(coerce(3.7, "number", "index")).toBe(3);
    expect(coerce(-2, "number", "index")).toBe(0);
    expect(coerce({ width: 10, height: 20 }, "json", "size")).toEqual([10, 20]);
    expect(coerce("#FFFFFFFF", "json", "color")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(coerce("true", "json", "boolean")).toBe(true);
  });
});

describe("canConnect", () => {
  it("allows identical types, any, and json", () => {
    expect(canConnect("number", "number")).toEqual({ ok: true });
    expect(canConnect("color", "any")).toEqual({ ok: true });
    expect(canConnect("json", "color").ok).toBe(true);
    expect(canConnect("point", "json").ok).toBe(true);
  });

  it("describes implicit conversions", () => {
    expect(canConnect("number", "boolean")).toMatchObject({ ok: true, conversion: "on when greater than 0" });
    expect(canConnect("boolean", "pulse")).toMatchObject({ ok: true, conversion: "fires when it turns on" });
    expect(canConnect("number", "point")).toMatchObject({ ok: true });
    expect(canConnect("size", "point")).toEqual({ ok: true });
    expect(canConnect("color", "point4d").ok).toBe(true);
    expect(canConnect("number", "text").ok).toBe(true);
    expect(canConnect("text", "enum").ok).toBe(true);
    expect(canConnect("pulse", "boolean")).toEqual({ ok: true });
  });

  it("rejects invalid links with a reason and converter", () => {
    const vec = canConnect("point", "point3d");
    expect(vec.ok).toBe(false);
    expect(vec.reason).toContain("2 numbers");
    expect(vec.suggestion).toBe("pointUnpack");
    expect(canConnect("text", "color")).toMatchObject({ ok: false, suggestion: "hexColor" });
    const layer = canConnect("number", "layer");
    expect(layer.ok).toBe(false);
    expect(layer.suggestion).toBeUndefined();
    expect(layer.reason).toContain("layer");
  });
});

describe("isInputValue", () => {
  it("accepts document encodings and rejects others", () => {
    for (const v of [1, true, "x", null, [1, 2], { link: "a.b" }, { layer: "l" }, { asset: "a" }, { loop: [1, "x"] }, { json: { a: 1 } }]) expect(isInputValue(v)).toBe(true);
    for (const v of [undefined, { link: 1 }, { a: 1 }, [1, "x"], Number.POSITIVE_INFINITY, { link: "a.b", extra: 1 }]) expect(isInputValue(v)).toBe(false);
  });
});
