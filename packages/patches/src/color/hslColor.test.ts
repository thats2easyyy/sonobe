import { formatColor } from "@sonobe/core";
import type { Color } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { hslColorPatch, hslToRgb } from "./hslColor.ts";

const color = (inputs: Record<string, unknown>) => createPatchHarness(hslColorPatch, { inputs }).step().outputs.color as Color;

describe("hslColor", () => {
  it("builds the golden values", () => {
    const golden: [number, number, number, string][] = [
      [0, 1, 0.5, "#FF0000FF"],
      [1 / 3, 1, 0.5, "#00FF00FF"],
      [2 / 3, 1, 0.5, "#0000FFFF"],
      [0.5, 1, 0.25, "#008080FF"],
      [0.3, 0, 0.5, "#808080FF"],
      [0.1, 0.8, 1, "#FFFFFFFF"],
      [0.1, 0.8, 0, "#000000FF"],
      [1.25, 1, 0.5, "#80FF00FF"],
      [-0.25, 1, 0.5, "#8000FFFF"],
    ];
    for (const [hue, saturation, lightness, hex] of golden) expect(formatColor(color({ hue, saturation, lightness })), `${hue},${saturation},${lightness}`).toBe(hex);
    const warm = color({ hue: 0.08, saturation: 0.9, lightness: 0.6 });
    expect(warm.r).toBeCloseTo(0.96, 6);
    expect(warm.g).toBeCloseTo(0.5856, 6);
    expect(warm.b).toBeCloseTo(0.24, 6);
  });

  it("defaults to opaque red and wraps Hue", () => {
    expect(formatColor(color({}))).toBe("#FF0000FF");
    expect(color({ hue: 1 })).toEqual(color({ hue: 0 }));
    expect(formatColor(color({ hue: 120 }))).toBe("#FF0000FF");
    expect(color({ hue: 0.25 })).toEqual(color({ hue: 1.25 }));
    expect(hslToRgb(-0.75, 1, 0.5)).toEqual(hslToRgb(0.25, 1, 0.5));
  });

  it("clamps Saturation, Lightness, and Alpha", () => {
    expect(color({ saturation: 5, lightness: 0.5, alpha: 2 })).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(formatColor(color({ saturation: -1, lightness: 0.5, alpha: -0.5 }))).toBe("#80808000");
    expect(formatColor(color({ lightness: 7 }))).toBe("#FFFFFFFF");
  });

  it("counts non-finite inputs as 0 and warns once each", () => {
    const h = createPatchHarness(hslColorPatch, { inputs: { hue: Number.NaN, lightness: Number.NEGATIVE_INFINITY } });
    expect(h.step().outputs.color).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    h.step();
    expect(h.logs).toHaveLength(2);
  });

  it("evaluates per loop index", () => {
    const frame = createPatchHarness(hslColorPatch, { inputs: { hue: loopOf([0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6]) } }).step();
    expect((frame.outputs.color as { items: Color[] }).items.map(formatColor)).toEqual(["#FF0000FF", "#FFFF00FF", "#00FF00FF", "#00FFFFFF", "#0000FFFF", "#FF00FFFF"]);
  });
});
