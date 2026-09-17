import { parseColor } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { colorToHslPatch, rgbToHsl } from "./colorToHsl.ts";
import { hslToRgb } from "./hslColor.ts";

const run = (color: unknown) => {
  const { outputs } = createPatchHarness(colorToHslPatch, { inputs: { color } }).step();
  return [outputs.hue, outputs.saturation, outputs.lightness, outputs.alpha] as number[];
};

const expectClose = (actual: readonly number[], expected: readonly number[], digits = 6) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, i) => expect(v, `component ${i}`).toBeCloseTo(expected[i]!, digits));
};

describe("colorToHsl", () => {
  it("describes the golden values", () => {
    expectClose(run("#FF0000FF"), [0, 1, 0.5, 1]);
    expectClose(run("#00FF00FF"), [0.333333, 1, 0.5, 1]);
    expectClose(run("#0000FFFF"), [0.666667, 1, 0.5, 1]);
    expectClose(run("#008080FF"), [0.5, 1, 0.25098, 1], 5);
    expectClose(run("#808080FF"), [0, 0, 0.501961, 1]);
    expectClose(run("#FFFFFFFF"), [0, 0, 1, 1]);
    expectClose(run("#FF5F6DFF"), [0.985417, 1, 0.686275, 1]);
    expectClose(run("#00000080"), [0, 0, 0, 0.501961]);
  });

  it("breaks ties for the maximum channel toward red, then green", () => {
    expectClose(run("#FFFF00FF"), [0.166667, 1, 0.5, 1]);
    expectClose(run("#FF00FFFF"), [0.833333, 1, 0.5, 1]);
    expectClose(run("#00FFFFFF"), [0.5, 1, 0.5, 1]);
  });

  it("keeps Hue below 1", () => {
    const [h] = rgbToHsl(1, 0, 1e-12);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(1);
  });

  it("round-trips through HSL Color", () => {
    for (const hex of ["#FF5F6D", "#5B5FEF", "#34C759", "#123456", "#FEDCBA", "#808080", "#010203"]) {
      const c = parseColor(hex)!;
      const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
      expectClose(hslToRgb(h, s, l), [c.r, c.g, c.b], 9);
    }
  });

  it("clamps channels and counts non-finite ones as 0 with one warning", () => {
    const h = createPatchHarness(colorToHslPatch, { inputs: { color: { r: 2, g: Number.NaN, b: -1, a: 1 } } });
    expect(h.step().outputs).toEqual({ hue: 0, saturation: 1, lightness: 0.5, alpha: 1 });
    expect(h.logs).toHaveLength(1);
  });

  it("gives loops of numbers for a loop of colors", () => {
    const frame = createPatchHarness(colorToHslPatch, { inputs: { color: loopOf(["#FF0000FF", "#FFFFFFFF"]) } }).step();
    expect(frame.outputs.lightness).toEqual(loopOf([0.5, 1]));
    expect(frame.outputs.saturation).toEqual(loopOf([1, 0]));
  });
});
