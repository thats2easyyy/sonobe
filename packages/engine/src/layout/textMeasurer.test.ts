import { describe, expect, it } from "vitest";
import {
  approximateGlyphWidth,
  approximateTextMeasurer,
  createApproximateTextMeasurer,
} from "./textMeasurer.ts";

const style = (
  overrides: Partial<{
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    letterSpacing: number;
    lineHeight: number;
  }> = {},
) => ({
  fontFamily: "Inter",
  fontSize: 17,
  fontWeight: 400,
  letterSpacing: 0,
  lineHeight: 0,
  ...overrides,
});

describe("approximate text measurer", () => {
  it("sums glyph widths by character class", () => {
    const { width, height } = approximateTextMeasurer.measure("Hello", style(), null);
    expect(width).toBeCloseTo((0.66 + 0.52 + 0.26 + 0.26 + 0.52) * 17, 9);
    expect(height).toBeCloseTo(17 * 1.2, 9);
    expect(approximateGlyphWidth("中", 20)).toBe(20);
    expect(approximateGlyphWidth("W", 10)).toBeGreaterThan(approximateGlyphWidth("i", 10));
  });

  it("empty text is one line tall and zero wide", () => {
    const { width, height } = approximateTextMeasurer.measure("", style({ fontSize: 10 }), null);
    expect(width).toBe(0);
    expect(height).toBe(12);
  });

  it("wraps words at maxWidth", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const single = approximateTextMeasurer.measure(text, style(), null);
    const wrapped = approximateTextMeasurer.measure(text, style(), 120);
    expect(wrapped.width).toBeLessThanOrEqual(120);
    const lines = Math.round(wrapped.height / (17 * 1.2));
    expect(lines).toBeGreaterThanOrEqual(Math.ceil(single.width / 120));
    expect(wrapped.height).toBeCloseTo(lines * 17 * 1.2, 9);
  });

  it("honors explicit newlines and line height", () => {
    expect(approximateTextMeasurer.measure("a\nb\nc", style({ lineHeight: 22 }), null).height).toBe(
      66,
    );
    expect(approximateTextMeasurer.measure("a\r\nb", style(), 500).height).toBeCloseTo(
      2 * 17 * 1.2,
      9,
    );
  });

  it("breaks long words by character", () => {
    const { width, height } = approximateTextMeasurer.measure("supercalifragilistic", style(), 40);
    expect(width).toBeLessThanOrEqual(40);
    expect(height / (17 * 1.2)).toBeGreaterThan(3);
  });

  it("zero width puts one glyph per line without looping forever", () => {
    const { height } = approximateTextMeasurer.measure("abc", style({ fontSize: 10 }), 0);
    expect(height).toBe(36);
  });

  it("letter spacing and weight widen text", () => {
    const base = approximateTextMeasurer.measure("abc", style(), null).width;
    expect(
      approximateTextMeasurer.measure("abc", style({ letterSpacing: 2 }), null).width,
    ).toBeCloseTo(base + 6, 9);
    expect(
      approximateTextMeasurer.measure("abc", style({ fontWeight: 700 }), null).width,
    ).toBeGreaterThan(base);
  });

  it("ignores trailing spaces on unwrapped lines", () => {
    const a = approximateTextMeasurer.measure("hi", style(), null).width;
    expect(approximateTextMeasurer.measure("hi   ", style(), null).width).toBeCloseTo(a, 9);
  });

  it("options scale widths and line height", () => {
    const wide = createApproximateTextMeasurer({ widthScale: 2, lineHeightFactor: 1.5 });
    const base = approximateTextMeasurer.measure("abc", style(), null);
    const scaled = wide.measure("abc", style(), null);
    expect(scaled.width).toBeCloseTo(base.width * 2, 9);
    expect(scaled.height).toBeCloseTo(17 * 1.5, 9);
  });
});
