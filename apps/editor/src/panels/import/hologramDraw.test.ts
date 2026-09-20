import { describe, expect, it } from "vitest";
import { BLOOM, bloomGap, bloomReach, cornerSteps, growRadii, perimeterPoints, TEXT_BAR_MAX, textBarThickness } from "./hologramDraw.ts";

describe("hologram drawing", () => {
  it("keeps text bars thin next to 1 px outlines however far it zooms in", () => {
    // A 22 pt line at 21%, 100% and 900%.
    expect(textBarThickness(22 * 0.21)).toBeCloseTo(2.03, 2);
    expect(textBarThickness(22)).toBe(TEXT_BAR_MAX);
    expect(textBarThickness(22 * 9)).toBe(TEXT_BAR_MAX);
    expect(TEXT_BAR_MAX).toBeLessThanOrEqual(4);
    expect(textBarThickness(1)).toBe(1.25);
  });

  it("traces rounded corners in short segments, so they stay round zoomed in", () => {
    expect(cornerSteps(2)).toBe(4);
    expect(cornerSteps(12)).toBe(8);
    // A 24 pt card corner at 900%: segments of about 2.5 px, not 27 px.
    const rad = 24 * 9;
    expect(cornerSteps(rad)).toBe(64);
    const pts = perimeterPoints({ x: 0, y: 0, width: 3000, height: 3000 }, rad);
    const longest = Math.max(...pts.slice(1).map((p, i) => (p[0] === pts[i]![0] || p[1] === pts[i]![1] ? 0 : Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]))));
    expect(longest).toBeLessThan(6);
  });

  it("lets the closing bloom reach less around a small screen, clear of the selection handles", () => {
    expect(bloomReach(402, 874)).toBe(BLOOM.reach);
    expect(bloomReach(85, 184)).toBeCloseTo(28.3, 1);
    expect(bloomReach(40, 87)).toBe(14);
    // The hairline clears the 8 px corner handles, and the band peaks past it.
    expect(BLOOM.gap).toBeGreaterThan(4);
    expect(BLOOM.peak).toBeGreaterThan(BLOOM.gap);
    expect(bloomGap(85, 184)).toBe(BLOOM.gap);
    // Around a 40 px screen (10% zoom), 5 px out would read as a second outline.
    expect(bloomGap(40, 87)).toBeCloseTo(3.33, 2);
    expect(bloomGap(12, 26)).toBe(2.5);
  });

  it("grows rounded corners concentrically, and keeps square ones square", () => {
    expect(growRadii([24, 24, 0, 0], 5)).toEqual([29, 29, 0, 0]);
    expect(growRadii([4, 4, 4, 4], -0.5)).toEqual([3.5, 3.5, 3.5, 3.5]);
  });
});
