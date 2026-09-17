import { describe, expect, it } from "vitest";
import { formatRulerValue, rulerRange, rulerScale, rulerTicks } from "./rulers.ts";

describe("rulerScale", () => {
  it("picks a 1-2-5 step whose labels stay at least 56 px apart", () => {
    expect(rulerScale(1)).toEqual({ major: 100, minor: 20 });
    expect(rulerScale(0.25)).toEqual({ major: 500, minor: 100 });
    expect(rulerScale(8)).toEqual({ major: 10, minor: 2 });
    expect(rulerScale(30)).toEqual({ major: 2, minor: 1 });
  });

  it("never goes below one point and survives bad zooms", () => {
    expect(rulerScale(64)).toEqual({ major: 1, minor: 1 });
    expect(rulerScale(Number.NaN)).toEqual(rulerScale(1));
    expect(rulerScale(0)).toEqual(rulerScale(1));
  });
});

describe("rulerTicks", () => {
  it("places ticks where artboard values land on screen, one extra on each side", () => {
    const ticks = rulerTicks(100, 1, 400);
    expect(ticks.find((t) => t.value === 0)).toEqual({ position: 100, value: 0, major: true });
    expect(ticks.find((t) => t.value === 20)).toEqual({ position: 120, value: 20, major: false });
    expect(ticks.filter((t) => t.major).map((t) => t.value)).toEqual([-100, 0, 100, 200, 300]);
    expect(ticks[0]!.position).toBeLessThanOrEqual(0);
    expect(ticks.at(-1)!.position).toBeGreaterThanOrEqual(400);
  });

  it("follows zoom", () => {
    const ticks = rulerTicks(0, 2, 200);
    const scale = rulerScale(2);
    expect(scale.major).toBe(50);
    expect(ticks.find((t) => t.value === 50)?.position).toBe(100);
    expect(rulerTicks(0, 0, 100)).toEqual([]);
  });
});

describe("ruler labels and ranges", () => {
  it("formats values without float noise", () => {
    expect(formatRulerValue(-0)).toBe("0");
    expect(formatRulerValue(100)).toBe("100");
    expect(formatRulerValue(12.5)).toBe("12.5");
    expect(formatRulerValue(0.1 + 0.2)).toBe("0.3");
  });

  it("reports the selection's extent on each ruler", () => {
    const bounds = { x: 10, y: 20, width: 100, height: 50 };
    const viewport = { x: 5, y: 7, zoom: 2 };
    expect(rulerRange(bounds, viewport, "x")).toEqual({ start: 25, end: 225, from: 10, to: 110 });
    expect(rulerRange(bounds, viewport, "y")).toEqual({ start: 47, end: 147, from: 20, to: 70 });
    expect(rulerRange(null, viewport, "x")).toBeNull();
  });
});
