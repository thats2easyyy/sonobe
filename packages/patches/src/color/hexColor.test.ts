import { formatColor } from "@sonobe/core";
import type { Color } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { hexColorPatch, parseHexCode } from "./hexColor.ts";

const run = (hex: unknown) => createPatchHarness(hexColorPatch, { inputs: { hex } }).step().outputs;

describe("hexColor", () => {
  it("reads the golden values", () => {
    const coral = run("FF5F6D");
    const c = coral.color as Color;
    expect(c.r).toBe(1);
    expect(c.g).toBeCloseTo(0.372549, 6);
    expect(c.b).toBeCloseTo(0.427451, 6);
    expect(c.a).toBe(1);
    expect(coral.valid).toBe(true);
    expect(formatColor(run(" #ff0000 ").color as Color)).toBe("#FF0000FF");
    expect(formatColor(run("#F0A").color as Color)).toBe("#FF00AAFF");
    expect(formatColor(run("#F0A8").color as Color)).toBe("#FF00AA88");
    expect((run("#F0A8").color as Color).a).toBeCloseTo(0.533333, 6);
    expect((run("#FF5F6D80").color as Color).a).toBeCloseTo(0.501961, 6);
  });

  it("outputs transparent and Valid false for invalid codes, without warning", () => {
    for (const hex of ["", "#12345", "GG0000", "0xFFFFFF", "FF 0000", "red", "rgb(255, 0, 0)", "##FFF", "#1234567", "#"]) {
      const h = createPatchHarness(hexColorPatch, { inputs: { hex } });
      expect(h.step().outputs, hex).toEqual({ color: { r: 0, g: 0, b: 0, a: 0 }, valid: false });
      expect(h.logs).toEqual([]);
    }
  });

  it("defaults to white and reads coerced numbers as digits", () => {
    expect(createPatchHarness(hexColorPatch).step().outputs).toEqual({ color: { r: 1, g: 1, b: 1, a: 1 }, valid: true });
    expect(formatColor(run(123456).color as Color)).toBe("#123456FF");
  });

  it("matches core parseColor for valid codes", () => {
    for (const digits of ["abc", "ABCD", "a1b2c3", "a1b2c3d4"]) expect(parseHexCode(digits), digits).toEqual(parseHexCodeViaCore(digits));
  });

  it("evaluates per loop index", () => {
    const frame = createPatchHarness(hexColorPatch, { inputs: { hex: loopOf(["#FF5F6D", "#FFC371", "nope"]) } }).step();
    expect(frame.outputs.valid).toEqual(loopOf([true, true, false]));
    expect((frame.outputs.color as { items: Color[] }).items.map(formatColor)).toEqual(["#FF5F6DFF", "#FFC371FF", "#00000000"]);
  });
});

function parseHexCodeViaCore(digits: string): Color | undefined {
  const bytes = digits.length <= 4 ? [...digits].map((d) => d + d).join("") : digits;
  const full = bytes.length === 6 ? `${bytes}FF` : bytes;
  const byte = (i: number) => parseInt(full.slice(2 * i, 2 * i + 2), 16) / 255;
  return { r: byte(0), g: byte(1), b: byte(2), a: byte(3) };
}
