import { describe, expect, it } from "vitest";
import { cmd, ellipsePath, f, formatPath, parsePath, readPoint, readSvgMarkup, reverseSubpaths, signedArea, transformSegments } from "./path.ts";
import type { Segment } from "./path.ts";

const fmt = (text: string) => formatPath(parsePath(text).segments);

describe("f and cmd", () => {
  it("rounds to 3 decimals, clamps to ±1,000,000, and never writes -0, NaN, or exponents", () => {
    expect(f(1.23456)).toBe("1.235");
    expect(f(123456.7891)).toBe("123456.789");
    expect(f(-0.0001)).toBe("0");
    expect(f(-0)).toBe("0");
    expect(f(1e-7)).toBe("0");
    expect(f(2e6)).toBe("1000000");
    expect(f(Number.NEGATIVE_INFINITY)).toBe("-1000000");
    expect(f(Number.NaN)).toBe("0");
  });

  it("writes the letter followed by numbers separated by single spaces", () => {
    expect(cmd("M", 50, 0)).toBe("M50 0");
    expect(cmd("A", 50, 50, 0, 0, 1, 100, 50)).toBe("A50 50 0 0 1 100 50");
    expect(cmd("Z")).toBe("Z");
  });

  it("draws an ellipse clockwise from the top center", () => {
    expect(ellipsePath(50, 50, 50, 30)).toBe("M50 20 A50 30 0 0 1 100 50 A50 30 0 0 1 50 80 A50 30 0 0 1 0 50 A50 30 0 0 1 50 20 Z");
  });
});

describe("parsePath", () => {
  it("reads absolute and relative commands and normalizes H, V, and Z", () => {
    expect(parsePath("M10 20 L30 40").segments).toEqual([["M", 10, 20], ["L", 30, 40]]);
    expect(fmt("m10 10 l5 5 h10 v-5 z")).toBe("M10 10 L15 15 L25 15 L25 10 Z");
    expect(fmt("M0 0 H7 V9")).toBe("M0 0 L7 0 L7 9");
  });

  it("repeats commands implicitly, with extra M pairs as lines", () => {
    expect(fmt("M0 0 10 10 20 0")).toBe("M0 0 L10 10 L20 0");
    expect(fmt("m0 0 10 10 20 0")).toBe("M0 0 L10 10 L30 10");
    expect(fmt("M0 0 L1 1 2 2")).toBe("M0 0 L1 1 L2 2");
  });

  it("treats a leading m as absolute", () => {
    expect(fmt("m5 5 l1 1")).toBe("M5 5 L6 6");
  });

  it("reads compact numbers, exponents, commas, and packed arc flags", () => {
    expect(fmt("M1-2.5.5 1")).toBe("M1 -2.5 L0.5 1");
    expect(fmt("M1e1 2E-1")).toBe("M10 0.2");
    expect(fmt("M0,0,L10,10")).toBe("M0 0 L10 10");
    expect(fmt("M0 0 a1 1 0 00 1 1")).toBe("M0 0 A1 1 0 0 0 1 1");
    expect(fmt("M0 0a1 1 0 1110 10")).toBe("M0 0 A1 1 0 1 1 10 10");
  });

  it("reflects the previous cubic's control for S and the previous quadratic's for T", () => {
    expect(fmt("M0 0 C10 0 20 10 30 10 S50 20 60 20")).toBe("M0 0 C10 0 20 10 30 10 C40 10 50 20 60 20");
    expect(fmt("M0 0 S10 10 20 20")).toBe("M0 0 C0 0 10 10 20 20");
    expect(fmt("M0 0 Q10 10 20 0 T40 0")).toBe("M0 0 Q10 10 20 0 Q30 -10 40 0");
    expect(fmt("M0 0 T10 0")).toBe("M0 0 Q0 0 10 0");
    expect(fmt("M0 0 L5 5 S10 10 20 20")).toBe("M0 0 L5 5 C5 5 10 10 20 20");
  });

  it("keeps arc radii and flags, and turns zero-radius arcs into lines", () => {
    expect(fmt("M0 0 A5 -6 30 1 0 10 10")).toBe("M0 0 A5 6 30 1 0 10 10");
    expect(fmt("M0 0 A0 5 0 0 1 10 10")).toBe("M0 0 L10 10");
    expect(fmt("M0 0 a5 5 0 0 1 10 10")).toBe("M0 0 A5 5 0 0 1 10 10");
  });

  it("returns to the subpath start after Z and starts a new subpath for the next drawing command", () => {
    expect(fmt("M10 10 L20 10 Z l5 5")).toBe("M10 10 L20 10 Z M10 10 L15 15");
    expect(fmt("M0 0 L1 1 Z Z")).toBe("M0 0 L1 1 Z");
    expect(fmt("M0 0 L1 1 Z M5 5 L6 6")).toBe("M0 0 L1 1 Z M5 5 L6 6");
  });

  it("reads empty and whitespace-only text as no segments without an error", () => {
    expect(parsePath("")).toEqual({ segments: [], syntaxError: null, errorAt: null });
    expect(parsePath("  \n\t")).toEqual({ segments: [], syntaxError: null, errorAt: null });
  });

  it("stops at the first syntax error and keeps the segments before the failing command", () => {
    const missing = parsePath("M0 0 L10");
    expect(missing.segments).toEqual([["M", 0, 0]]);
    expect(missing.syntaxError).toBe('Path data stops at character 9: expected a number after "L".');
    expect(missing.errorAt).toBe(9);

    const implicit = parsePath("M0 0 L10 10 20");
    expect(implicit.segments).toEqual([["M", 0, 0], ["L", 10, 10]]);
    expect(implicit.syntaxError).toBe('Path data stops at character 15: expected a number after "L".');

    expect(parsePath("M0 0 X1 1").syntaxError).toBe('Path data stops at character 6: unknown command "X".');
    expect(parsePath("L0 0").syntaxError).toBe('Path data stops at character 1: the path must start with "M", not "L".');
    expect(parsePath("M0 0 Z 5").syntaxError).toBe('Path data stops at character 8: expected a command after "Z".');
    expect(parsePath("M0 0 A1 1 0 2 0 5 5").syntaxError).toBe('Path data stops at character 13: expected an arc flag (0 or 1) after "A".');
    expect(parsePath("M0,,0").syntaxError).toBe('Path data stops at character 4: expected a number after "M".');
  });
});

describe("transformSegments", () => {
  it("scales and translates coordinates and scales arc radii", () => {
    const segments: Segment[] = [["M", 0, 0], ["C", 1, 2, 3, 4, 5, 6], ["Q", 1, 1, 2, 2], ["A", 5, 5, 30, 1, 0, 10, 10], ["Z"]];
    expect(transformSegments(segments, 2, 1, -1)).toEqual([["M", 1, -1], ["C", 3, 3, 7, 7, 11, 11], ["Q", 3, 1, 5, 3], ["A", 10, 10, 30, 1, 0, 21, 19], ["Z"]]);
  });
});

describe("signedArea and reverseSubpaths", () => {
  it("is positive for clockwise outlines on screen (y down)", () => {
    expect(signedArea(parsePath("M0 0 L10 0 L10 10 L0 10 Z").segments)).toBe(100);
    expect(signedArea(parsePath("M0 0 L0 10 L10 10 L10 0 Z").segments)).toBe(-100);
  });

  it("samples arcs and curves", () => {
    const circle = signedArea(parsePath(ellipsePath(50, 50, 50, 50)).segments);
    expect(circle).toBeGreaterThan(0);
    expect(Math.abs(circle - Math.PI * 2500) / (Math.PI * 2500)).toBeLessThan(0.01);
    const curve = signedArea(parsePath("M0 0 C50 0 100 50 100 100 L0 100 Z").segments);
    expect(curve).toBeGreaterThan(0);
  });

  it("reverses lines, cubics, quadratics, and arcs", () => {
    expect(formatPath(reverseSubpaths(parsePath("M0 0 L0 10 L10 10 Z").segments))).toBe("M0 0 L10 10 L0 10 L0 0 Z");
    expect(formatPath(reverseSubpaths(parsePath("M0 0 C1 2 3 4 5 6").segments))).toBe("M5 6 C3 4 1 2 0 0");
    expect(formatPath(reverseSubpaths(parsePath("M0 0 Q1 2 3 4").segments))).toBe("M3 4 Q1 2 0 0");
    expect(formatPath(reverseSubpaths(parsePath("M50 0 A50 50 0 1 1 100 50").segments))).toBe("M100 50 A50 50 0 1 0 50 0");
    expect(formatPath(reverseSubpaths(parsePath("M0 0 L10 0 L0 0 Z").segments))).toBe("M0 0 L10 0 L0 0 Z");
  });

  it("keeps subpath order and flips every subpath's area", () => {
    const segments = parsePath("M0 0 L10 0 L10 10 Z M20 20 L20 30 L30 30 Z").segments;
    const reversed = reverseSubpaths(segments);
    expect(formatPath(reversed)).toBe("M0 0 L10 10 L10 0 L0 0 Z M20 20 L30 30 L20 30 L20 20 Z");
    expect(signedArea(reversed)).toBeCloseTo(-signedArea(segments), 9);
    const circle = parsePath(ellipsePath(50, 50, 50, 50)).segments;
    expect(signedArea(reverseSubpaths(circle))).toBeCloseTo(-signedArea(circle), 6);
  });
});

describe("readPoint", () => {
  it("accepts [x, y] arrays and { x, y } objects with finite numbers or numeric strings", () => {
    expect(readPoint([1, 2])).toEqual([1, 2]);
    expect(readPoint([1, 2, 3])).toEqual([1, 2]);
    expect(readPoint({ x: "12.5", y: 3 })).toEqual([12.5, 3]);
    expect(readPoint([1])).toBeNull();
    expect(readPoint({ x: 1 })).toBeNull();
    expect(readPoint(["a", 1])).toBeNull();
    expect(readPoint(["", 1])).toBeNull();
    expect(readPoint([Number.NaN, 1])).toBeNull();
    expect(readPoint(5)).toBeNull();
    expect(readPoint(null)).toBeNull();
  });
});

describe("readSvgMarkup", () => {
  it("reads every <path> d in document order and the first svg's viewBox", () => {
    const svg = readSvgMarkup(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0L1 1"/><path fill="red" d='M2 2L3 3'></path></svg>`);
    expect(svg).toEqual({ paths: ["M0 0L1 1", "M2 2L3 3"], viewBox: [0, 0, 24, 24], problems: [] });
    expect(readSvgMarkup(`<svg viewBox="0,0,48,32"><path d="M0 0"/></svg>`).viewBox).toEqual([0, 0, 48, 32]);
  });

  it("falls back to plain numeric width and height", () => {
    expect(readSvgMarkup(`<svg width="48px" height="32"><path d="M0 0"/></svg>`).viewBox).toEqual([0, 0, 48, 32]);
    expect(readSvgMarkup(`<svg width="100%" height="32"><path d="M0 0"/></svg>`).viewBox).toBeNull();
    expect(readSvgMarkup(`<svg viewBox="0 0 24"><path d="M0 0"/></svg>`).viewBox).toBeNull();
  });

  it("reports other shapes, transforms, and missing paths once each", () => {
    const svg = readSvgMarkup(`<svg><circle cx="1"/><rect/><g transform="translate(1 1)"><path d="M0 0" transform="scale(2)"/></g></svg>`);
    expect(svg.problems).toEqual([
      "Only <path> elements are read; flatten other shapes before copying.",
      "Transforms in the SVG are ignored; flatten the artwork before copying.",
    ]);
    expect(readSvgMarkup(`<svg><rect/></svg>`).problems).toEqual([
      "Only <path> elements are read; flatten other shapes before copying.",
      "The SVG has no <path> elements.",
    ]);
  });

  it("skips comments and CDATA", () => {
    const svg = readSvgMarkup(`<!-- <path d="M9 9"/> --><svg><![CDATA[<path d="M8 8"/>]]><path d="M0 0"/></svg>`);
    expect(svg.paths).toEqual(["M0 0"]);
  });
});
