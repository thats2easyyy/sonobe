// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("DomTextMeasurer: what it keeps", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const TEXT = "hello wide world";

  it("lays a wrapped text out once, and hands every later call the same frozen layout", () => {
    const m = measurer();
    const first = m.layout(TEXT, style(), 60);
    expect(first.lines).toEqual(["hello ", "wide ", "world"]);
    expect(m.layout(TEXT, style(), 60)).toBe(first);
    expect(m.layout(TEXT, { ...style() }, 60).lines).toBe(first.lines);
    expect([Object.isFrozen(first), Object.isFrozen(first.lines), Object.isFrozen(first.lineWidths)]).toEqual([true, true, true]);
    expect(m.measure(TEXT, style(), 60)).toEqual({ width: 50, height: 60 });
    // Text that only breaks at its newlines is cheap to lay out and isn't kept.
    expect(m.layout(TEXT, style(), null)).not.toBe(m.layout(TEXT, style(), null));
    expect(m.layout(TEXT, style(), null)).toEqual(m.layout(TEXT, style(), null));
  });

  it("lays out again when anything a layout is made from differs", () => {
    // Widths and line heights that follow every part of the font, so a stale layout would show.
    const m = new DomTextMeasurer({
      measureWidth: (t, font, size) => [...t].length * size + (font.includes("italic") ? 1 : 0) + (font.includes("700") ? 2 : 0) + (font.includes("Georgia") ? 3 : 0),
      measureLineHeight: (font, size) => size * 2 + (font.includes("Georgia") ? 1 : 0),
    });
    const base = style({ fontSize: 10 });
    const kept = m.layout(TEXT, base, 60);
    expect([kept.lines, kept.lineWidths, kept.height]).toEqual([["hello ", "wide ", "world"], [50, 40, 50], 60]);
    const others: [string, TextStyle, number, string][] = [
      ["font size", style({ fontSize: 12 }), 60, TEXT],
      ["font weight", style({ fontSize: 10, fontWeight: 700 }), 60, TEXT],
      ["font family", style({ fontSize: 10, fontFamily: "Georgia" }), 60, TEXT],
      ["italic", style({ fontSize: 10, italic: true }), 60, TEXT],
      ["letter spacing", style({ fontSize: 10, letterSpacing: 2 }), 60, TEXT],
      ["line height", style({ fontSize: 10, lineHeight: 33 }), 60, TEXT],
      ["text transform", style({ fontSize: 10, textTransform: "uppercase" }), 60, TEXT],
      ["max width", base, 100, TEXT],
      ["text", base, 60, "hello wide words"],
    ];
    const seen = new Set<unknown>([kept]);
    for (const [what, s, maxWidth, text] of others) {
      const layout = m.layout(text, s, maxWidth);
      expect(seen.has(layout), what).toBe(false);
      seen.add(layout);
      // And each is what a measurer that kept nothing lays out.
      const fresh = new DomTextMeasurer({
        measureWidth: (t, font, size) => [...t].length * size + (font.includes("italic") ? 1 : 0) + (font.includes("700") ? 2 : 0) + (font.includes("Georgia") ? 3 : 0),
        measureLineHeight: (font, size) => size * 2 + (font.includes("Georgia") ? 1 : 0),
      });
      expect(layout, what).toEqual(fresh.layout(text, s, maxWidth));
      expect(layout, what).not.toEqual(kept);
    }
    expect(m.layout(TEXT, base, 60)).toBe(kept);
  });

  it("forgets its layouts when a font finishes loading, and on clearCache()", () => {
    const fonts = new EventTarget();
    let glyph = 10;
    const m = new DomTextMeasurer({ measureWidth: (t) => [...t].length * glyph, measureLineHeight: () => 20, document: { fonts } as unknown as Document });
    const fallback = m.layout(TEXT, style(), 60);
    expect(fallback.lines).toHaveLength(3);
    // The web font arrives and is narrower: the same text fits on two lines.
    glyph = 5;
    expect(m.layout(TEXT, style(), 60)).toBe(fallback);
    fonts.dispatchEvent(new Event("loadingdone"));
    const loaded = m.layout(TEXT, style(), 60);
    expect(loaded.lines).toEqual(["hello wide ", "world"]);
    expect(m.layout(TEXT, style(), 60)).toBe(loaded);
    m.clearCache();
    expect(m.layout(TEXT, style(), 60)).not.toBe(loaded);
    m.dispose();
  });

  it("keeps the 2,000 newest layouts: the oldest goes when another arrives", () => {
    const m = measurer();
    const first = m.layout("text 0 wraps", style(), 60);
    const second = m.layout("text 1 wraps", style(), 60);
    for (let i = 2; i < 2000; i++) m.layout(`text ${i} wraps`, style(), 60);
    expect(m.layout("text 0 wraps", style(), 60)).toBe(first);
    m.layout("text 2000 wraps", style(), 60);
    expect(m.layout("text 1 wraps", style(), 60)).toBe(second);
    const again = m.layout("text 0 wraps", style(), 60);
    expect(again).not.toBe(first);
    expect(again).toEqual(first);
  });

  it("counts a letter-spaced string's graphemes once", () => {
    const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");
    const m = new DomTextMeasurer({ measureWidth: (t) => t.length * 10, measureLineHeight: () => 20 });
    const spaced = style({ letterSpacing: 2 });
    expect(m.textWidth("👍🏽 ok", spaced)).toBe(70 + 4 * 2);
    const calls = segment.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(m.textWidth("👍🏽 ok", spaced)).toBe(78);
    expect(m.measure("👍🏽 ok", style({ letterSpacing: 3 }), null).width).toBe(70 + 4 * 3);
    expect(segment.mock.calls.length).toBe(calls);
    m.clearCache();
    expect(m.textWidth("👍🏽 ok", spaced)).toBe(78);
    expect(segment.mock.calls.length).toBeGreaterThan(calls);
  });
});
