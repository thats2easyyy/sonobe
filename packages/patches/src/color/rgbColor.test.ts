import { formatColor } from "@sonobe/core";
import type { Color } from "@sonobe/core";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { rgbColorPatch } from "./rgbColor.ts";

const hex = (inputs: Record<string, unknown>) => formatColor(createPatchHarness(rgbColorPatch, { inputs }).step().outputs.color as Color);

describe("rgbColor", () => {
  it("builds the golden values", () => {
    expect(hex({ red: 1, green: 0.5, blue: 0, alpha: 1 })).toBe("#FF8000FF");
    expect(hex({ red: 0, green: 0, blue: 0, alpha: 0.5 })).toBe("#00000080");
    expect(hex({ red: 2, green: -1, blue: 0.25, alpha: 1 })).toBe("#FF0040FF");
    expect(hex({})).toBe("#000000FF");
  });

  it("clamps every channel without 0–255 detection", () => {
    expect(createPatchHarness(rgbColorPatch, { inputs: { red: 255, green: 1.4, blue: -0.2, alpha: 3 } }).step().outputs.color).toEqual({ r: 1, g: 1, b: 0, a: 1 });
  });

  it("keeps straight channels when alpha is 0", () => {
    expect(createPatchHarness(rgbColorPatch, { inputs: { red: 0.2, green: 0.4, blue: 0.6, alpha: 0 } }).step().outputs.color).toEqual({ r: 0.2, g: 0.4, b: 0.6, a: 0 });
  });

  it("counts non-finite channels as 0 and warns once per channel per restart", () => {
    const h = createPatchHarness(rgbColorPatch, { inputs: { red: Number.NaN, green: 1, blue: Number.POSITIVE_INFINITY } });
    expect(h.step().outputs.color).toEqual({ r: 0, g: 1, b: 0, a: 1 });
    h.step();
    expect(h.logs.map((l) => l.message)).toEqual(["RGB Color: Red isn't a finite number, so it counts as 0.", "RGB Color: Blue isn't a finite number, so it counts as 0."]);
  });

  it("evaluates per loop index", () => {
    const frame = createPatchHarness(rgbColorPatch, { inputs: { red: loopOf([0, 0.5, 1]), blue: 1 } }).step();
    expect((frame.outputs.color as { items: Color[] }).items.map(formatColor)).toEqual(["#0000FFFF", "#8000FFFF", "#FF00FFFF"]);
  });

  it("runs in the engine evaluator and outputs transparent while muted", () => {
    expect(runPatch(rgbColorPatch, [{ red: 1 }]).frames[0]!.outputs.color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(runPatch(rgbColorPatch, [{ red: 1 }], { muted: true }).frames[0]!.outputs.color).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});
