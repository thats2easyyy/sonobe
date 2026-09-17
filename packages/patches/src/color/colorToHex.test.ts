import type { Color } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { colorToHexPatch } from "./colorToHex.ts";
import { hexColorPatch } from "./hexColor.ts";

const run = (inputs: Record<string, unknown>) => createPatchHarness(colorToHexPatch, { inputs }).step().outputs.hex;

describe("colorToHex", () => {
  it("writes the golden values", () => {
    expect(run({ color: { r: 1, g: 0.372549, b: 0.427451, a: 1 } })).toBe("#FF5F6D");
    expect(run({ color: { r: 0.5, g: 0.5, b: 0.5, a: 0.5 } })).toBe("#808080");
    expect(run({ color: { r: 0.5, g: 0.5, b: 0.5, a: 0.5 }, includeAlpha: true })).toBe("#80808080");
    expect(run({ color: "#00000000" })).toBe("#000000");
    expect(run({ color: "#00000000", includeAlpha: true })).toBe("#00000000");
    expect(createPatchHarness(colorToHexPatch).step().outputs.hex).toBe("#FFFFFF");
  });

  it("clamps channels before rounding", () => {
    expect(run({ color: { r: 1.4, g: -0.2, b: 0.25, a: 3 }, includeAlpha: true })).toBe("#FF0040FF");
  });

  it("counts non-finite channels as 0 and warns once, checking alpha only when it's written", () => {
    const h = createPatchHarness(colorToHexPatch, { inputs: { color: { r: 1, g: 1, b: 1, a: Number.NaN } } });
    expect(h.step().outputs.hex).toBe("#FFFFFF");
    expect(h.logs).toEqual([]);
    expect(h.step({ inputs: { includeAlpha: true } }).outputs.hex).toBe("#FFFFFF00");
    h.step({ inputs: { color: { r: Number.NaN, g: 1, b: 1, a: 1 } } });
    expect(h.output("hex")).toBe("#00FFFFFF");
    expect(h.logs).toHaveLength(1);
  });

  it("round-trips through Hex Color within 1/510 per channel", () => {
    const original: Color = { r: 0.123, g: 0.456, b: 0.789, a: 0.321 };
    const hex = run({ color: original, includeAlpha: true });
    const back = createPatchHarness(hexColorPatch, { inputs: { hex } }).step().outputs.color as Color;
    for (const key of ["r", "g", "b", "a"] as const) expect(Math.abs(back[key] - original[key])).toBeLessThanOrEqual(1 / 510 + 1e-12);
  });

  it("gives a loop of codes for a loop of colors", () => {
    expect(run({ color: loopOf(["#FF0000FF", "#00FF0080"]), includeAlpha: loopOf([false, true]) })).toEqual(loopOf(["#FF0000", "#00FF0080"]));
  });
});
