import { describe, expect, it } from "vitest";
import { REJECTED, fromScriptValue, previewValue, toScriptValue } from "./conversions.ts";

const services = { resolveAssetUrl: (id: string) => (id === "photo" ? "blob:photo" : undefined) };

describe("toScriptValue", () => {
  it("copies engine values into plain script data", () => {
    const color = { r: 1, g: 0.5, b: 0, a: 1 };
    const scriptColor = toScriptValue(color, "color", services) as { r: number };
    expect(scriptColor).toEqual(color);
    scriptColor.r = 0;
    expect(color.r).toBe(1);
    expect(toScriptValue([1, 2], "point", services)).toEqual([1, 2]);
    expect(toScriptValue({ a: [1, undefined] }, "json", services)).toEqual({ a: [1, null] });
    expect(toScriptValue({ layerId: "card", instance: 2 }, "layer", services)).toEqual({ layerId: "card", instance: 2 });
    expect(toScriptValue(null, "layer", services)).toBeNull();
    expect(toScriptValue({ assetId: "photo" }, "image", services)).toEqual({ assetId: "photo", url: "blob:photo" });
    expect(toScriptValue({ assetId: "missing" }, "sound", services)).toEqual({ assetId: "missing" });
    expect(toScriptValue(true, "pulse", services)).toBe(true);
  });
});

describe("fromScriptValue", () => {
  it("converts numbers, indexes, booleans, and text", () => {
    expect(fromScriptValue(4.5, "number")).toBe(4.5);
    expect(fromScriptValue(true, "number")).toBe(1);
    expect(fromScriptValue(" 12 ", "number")).toBe(12);
    expect(fromScriptValue("twelve", "number")).toBe(REJECTED);
    expect(fromScriptValue(Infinity, "number")).toBe(REJECTED);
    expect(fromScriptValue(-2.7, "index")).toBe(0);
    expect(fromScriptValue(2.7, "index")).toBe(2);
    expect(fromScriptValue("", "boolean")).toBe(false);
    expect(fromScriptValue({}, "boolean")).toBe(true);
    expect(fromScriptValue(3, "text")).toBe("3");
    expect(fromScriptValue({ a: [1] }, "text")).toBe('{"a":[1]}');
    expect(fromScriptValue(undefined, "text")).toBe(REJECTED);
  });

  it("maps null to zero values, or null for references and media", () => {
    expect(fromScriptValue(null, "number")).toBe(0);
    expect(fromScriptValue(null, "color")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(fromScriptValue(null, "point3d")).toEqual([0, 0, 0]);
    expect(fromScriptValue(null, "enum", [{ key: "small", name: "Small" }])).toBe("small");
    expect(fromScriptValue(null, "layer")).toBeNull();
    expect(fromScriptValue(null, "image")).toBeNull();
  });

  it("checks enums, colors, and vectors", () => {
    const options = [{ key: "small", name: "Small" }];
    expect(fromScriptValue("small", "enum", options)).toBe("small");
    expect(fromScriptValue("huge", "enum", options)).toBe(REJECTED);
    expect(fromScriptValue({ r: 2, g: 0.5, b: -1 }, "color")).toEqual({ r: 1, g: 0.5, b: 0, a: 1 });
    expect(fromScriptValue("#F80", "color")).toEqual({ r: 1, g: 0x88 / 255, b: 0, a: 1 });
    expect(fromScriptValue("red", "color")).toBe(REJECTED);
    expect(fromScriptValue([1, 2], "point")).toEqual([1, 2]);
    expect(fromScriptValue([1, 2, 3], "point")).toBe(REJECTED);
    expect(fromScriptValue(5, "point3d")).toEqual([5, 5, 5]);
    expect(fromScriptValue({ x: 1, y: 2 }, "point3d")).toEqual([1, 2, 0]);
    expect(fromScriptValue({ width: 10, height: 20 }, "size")).toEqual([10, 20]);
    expect(fromScriptValue([1, NaN], "point")).toBe(REJECTED);
    expect(fromScriptValue(new Array(16).fill(1), "transform")).toHaveLength(16);
  });

  it("accepts plain JSON data and rejects cycles and non-finite numbers", () => {
    expect(fromScriptValue({ a: 1, f: () => 1, u: undefined, list: [undefined, 2] }, "json")).toEqual({ a: 1, list: [null, 2] });
    expect(fromScriptValue(new Date(0), "json")).toBe("1970-01-01T00:00:00.000Z");
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(fromScriptValue(cycle, "json")).toBe(REJECTED);
    expect(fromScriptValue({ n: NaN }, "json")).toBe(REJECTED);
  });

  it("converts layers, media, shapes, gradients, effects, and text styles", () => {
    expect(fromScriptValue("card", "layer")).toEqual({ layerId: "card" });
    expect(fromScriptValue({ layerId: "card", instance: -1 }, "layer")).toBe(REJECTED);
    expect(fromScriptValue("https://example.com/a.png", "image")).toEqual({ url: "https://example.com/a.png" });
    expect(fromScriptValue({ assetId: "photo", url: "x" }, "video")).toEqual({ assetId: "photo" });
    expect(fromScriptValue("M 0 0 L 10 10", "shape")).toEqual({ path: "M 0 0 L 10 10" });
    expect(fromScriptValue({ kind: "linear", stops: [{ offset: 0, color: "#000" }, { offset: 1, color: { r: 1, g: 1, b: 1 } }] }, "gradient")).toEqual({
      kind: "linear",
      stops: [
        { offset: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { offset: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
      ],
      start: [0.5, 0],
      end: [0.5, 1],
    });
    expect(fromScriptValue({ kind: "blur", params: { radius: 4 } }, "layerEffect")).toEqual({ kind: "blur", params: { radius: 4 } });
    expect(fromScriptValue({ fontSize: 17, italic: true }, "textStyle")).toEqual({ fontSize: 17, italic: true });
    expect(fromScriptValue({ fontSize: 17, glow: true }, "textStyle")).toBe(REJECTED);
  });

  it("previews values briefly", () => {
    expect(previewValue("a".repeat(60))).toHaveLength(40);
    expect(previewValue(undefined)).toBe("undefined");
    expect(previewValue({ a: 1 })).toBe('{"a":1}');
  });
});
