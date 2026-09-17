// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { DomTextMeasurer, approximateWidth, breakChunks, cssFont, fontStack } from "./textMeasurer.ts";
import type { TextStyle } from "./textMeasurer.ts";

/** 10pt per grapheme, 20pt lines: easy arithmetic. */
const measurer = () => new DomTextMeasurer({ measureWidth: (t) => [...t].length * 10, measureLineHeight: () => 20 });
const style = (extra: Partial<TextStyle> = {}): TextStyle => ({ fontFamily: "Inter", fontSize: 17, fontWeight: 400, letterSpacing: 0, lineHeight: 0, ...extra });

describe("DomTextMeasurer", () => {
  it("wraps words greedily with hanging spaces", () => {
    const m = measurer();
    const l = m.layout("hello world", style(), 60);
    expect(l.lines).toEqual(["hello ", "world"]);
    expect(l.lineWidths).toEqual([50, 50]);
    expect(m.measure("hello world", style(), 60)).toEqual({ width: 50, height: 40 });
    // "hello " (60 with the space) still fits a 50pt line because trailing spaces hang.
    expect(m.layout("hello world", style(), 50).lines).toEqual(["hello ", "world"]);
    expect(m.measure("ab   ", style(), null).width).toBe(20);
  });

  it("does not wrap without a max width", () => {
    expect(measurer().measure("hello wide world", style(), null)).toEqual({ width: 160, height: 20 });
  });

  it("keeps explicit newlines, including empty lines", () => {
    const l = measurer().layout("a\n\nbb", style(), null);
    expect(l.lines).toEqual(["a", "", "bb"]);
    expect(l.height).toBe(60);
  });

  it("breaks words longer than the line", () => {
    expect(measurer().layout("abcdefghij", style(), 35).lines).toEqual(["abc", "def", "ghi", "j"]);
    expect(measurer().layout("go abcdefghij", style(), 40).lines).toEqual(["go ", "abcd", "efgh", "ij"]);
  });

  it("breaks after hyphens and between CJK characters", () => {
    expect(breakChunks("well-known fact")).toEqual(["well-", "known ", "fact"]);
    expect(measurer().layout("well-known", style(), 60).lines).toEqual(["well-", "known"]);
    expect(measurer().layout("日本語のテキスト", style(), 30).lines).toEqual(["日本語", "のテキ", "スト"]);
    expect(breakChunks("终于。好")).toEqual(["终", "于。", "好"]);
  });

  it("adds letter spacing per character", () => {
    expect(measurer().measure("abcd", style({ letterSpacing: 2 }), null).width).toBe(48);
    expect(measurer().layout("ab cd", style({ letterSpacing: 5 }), 40).lines).toEqual(["ab ", "cd"]);
  });

  it("rounds widths up to whole points", () => {
    const m = new DomTextMeasurer({ measureWidth: (t) => t.length * 7.3, measureLineHeight: () => 18 });
    expect(m.measure("abc", style(), null).width).toBe(22);
  });

  it("uses explicit line height, else the natural one", () => {
    const m = new DomTextMeasurer({ measureWidth: (t) => t.length, measureLineHeight: (_font, size) => size * 1.2 });
    expect(m.lineHeightFor(style({ lineHeight: 24 }))).toBe(24);
    expect(m.lineHeightFor(style({ fontSize: 20 }))).toBe(24);
    expect(m.measure("a\nb", style({ lineHeight: 30 }), null).height).toBe(60);
  });

  it("applies text transforms before measuring", () => {
    const m = new DomTextMeasurer({ measureWidth: (t) => [...t].reduce((w, c) => w + (c === c.toUpperCase() ? 20 : 10), 0), measureLineHeight: () => 20 });
    expect(m.measure("ab", style({ textTransform: "uppercase" }), null).width).toBe(40);
    expect(m.layout("hello there", style({ textTransform: "capitalize" }), null).lines).toEqual(["Hello There"]);
  });

  it("truncates in the middle", () => {
    const m = measurer();
    const t = m.truncateMiddle("abcdefghijklmnop", style(), 70);
    expect(t).toBe("abc…nop");
    expect(m.truncateMiddle("short", style(), 70)).toBe("short");
    expect(m.truncateMiddleLines("one two three four five six", style(), 90, 2)).toBe("one two\nthree…six");
    expect(m.truncateMiddleLines("IMG_20260916_final_v2.png", style(), 120, 1)).toBe("IMG_20…2.png");
    expect(m.truncateMiddleLines("short", style(), 120, 2)).toBe("short");
  });

  it("falls back to approximate metrics without a canvas", () => {
    const m = new DomTextMeasurer();
    const size = m.measure("Hello world", style(), null);
    expect(size.width).toBeGreaterThan(40);
    expect(size.height).toBeCloseTo(17 * 1.2, 1);
    expect(approximateWidth("MMM", 10)).toBeGreaterThan(approximateWidth("iii", 10));
  });

  it("builds font strings with fallbacks", () => {
    expect(fontStack("SF Pro")).toMatch(/^"SF Pro", system-ui/);
    expect(fontStack("monospace")).toMatch(/^monospace, /);
    expect(fontStack("Georgia, serif")).toBe("Georgia, serif");
    expect(cssFont(style({ italic: true, fontWeight: 650, fontSize: 13 }))).toMatch(/^italic 650 13px "Inter"/);
  });
});
