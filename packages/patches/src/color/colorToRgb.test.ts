import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { colorToRgbPatch } from "./colorToRgb.ts";

const run = (color: unknown) => createPatchHarness(colorToRgbPatch, { inputs: { color } }).step().outputs;

describe("colorToRgb", () => {
  it("splits the golden values", () => {
    const orange = run("#FF8000FF");
    expect(orange.red).toBe(1);
    expect(orange.green).toBeCloseTo(0.501961, 6);
    expect(orange.blue).toBe(0);
    expect(orange.alpha).toBe(1);
    expect(run("#00000000")).toEqual({ red: 0, green: 0, blue: 0, alpha: 0 });
    expect(createPatchHarness(colorToRgbPatch).step().outputs).toEqual({ red: 1, green: 1, blue: 1, alpha: 1 });
  });

  it("keeps channels straight, not multiplied by alpha", () => {
    const half = run("#FF000080");
    expect(half.red).toBe(1);
    expect(half.alpha).toBeCloseTo(0.501961, 6);
  });

  it("clamps out-of-range channels and counts non-finite ones as 0 with one warning", () => {
    const h = createPatchHarness(colorToRgbPatch, { inputs: { color: { r: 1.5, g: -0.25, b: Number.NaN, a: Number.POSITIVE_INFINITY } } });
    expect(h.step().outputs).toEqual({ red: 1, green: 0, blue: 0, alpha: 0 });
    h.step();
    expect(h.logs).toHaveLength(1);
  });

  it("gives loops of numbers for a loop of colors", () => {
    const frame = createPatchHarness(colorToRgbPatch, { inputs: { color: loopOf(["#FF0000FF", "#0000FFFF"]) } }).step();
    expect(frame.outputs.red).toEqual(loopOf([1, 0]));
    expect(frame.outputs.blue).toEqual(loopOf([0, 1]));
  });
});
