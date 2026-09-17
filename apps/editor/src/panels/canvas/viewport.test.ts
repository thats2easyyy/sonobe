import { describe, expect, it } from "vitest";
import { artboardToScreen, clampZoom, ensureVisible, fitRect, formatZoom, MAX_ZOOM, nextZoomStep, screenToArtboard, wheelZoom, zoomAt } from "./viewport.ts";

describe("canvas viewport", () => {
  it("converts between artboard and screen", () => {
    const vp = { x: 40, y: 20, zoom: 2 };
    expect(artboardToScreen(vp, [10, 5])).toEqual([60, 30]);
    expect(screenToArtboard(vp, [60, 30])).toEqual([10, 5]);
  });

  it("zooms about a screen point", () => {
    const vp = { x: 10, y: 10, zoom: 1 };
    const next = zoomAt(vp, 4, [110, 60]);
    expect(next.zoom).toBe(4);
    expect(screenToArtboard(next, [110, 60])).toEqual(screenToArtboard(vp, [110, 60]));
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
  });

  it("fits and centers a rect", () => {
    const vp = fitRect({ x: 0, y: 0, width: 400, height: 800 }, [500, 500], { padding: 50 });
    expect(vp.zoom).toBe(0.5);
    expect(artboardToScreen(vp, [200, 400])).toEqual([250, 250]);
    expect(fitRect({ x: 0, y: 0, width: 10, height: 10 }, [500, 500]).zoom).toBe(1);
  });

  it("steps through zoom presets", () => {
    expect(nextZoomStep(1, 1)).toBe(1.5);
    expect(nextZoomStep(1, -1)).toBe(0.75);
    expect(nextZoomStep(0.8, -1)).toBe(0.75);
  });

  it("zooms in on negative wheel deltas (pinch out)", () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    expect(wheelZoom(vp, -10, [0, 0]).zoom).toBeGreaterThan(1);
    expect(wheelZoom(vp, 10, [0, 0]).zoom).toBeLessThan(1);
    // Mouse wheel jumps are capped.
    expect(wheelZoom(vp, 1000, [0, 0]).zoom).toBeCloseTo(Math.exp(-0.4));
  });

  it("pans to reveal off-screen rects", () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    expect(ensureVisible(vp, { x: 100, y: 100, width: 50, height: 50 }, [800, 600])).toBe(vp);
    const moved = ensureVisible(vp, { x: 2000, y: 100, width: 50, height: 50 }, [800, 600]);
    expect(artboardToScreen(moved, [2025, 125])).toEqual([400, 300]);
  });

  it("formats zoom", () => {
    expect(formatZoom(0.5)).toBe("50%");
    expect(formatZoom(0.055)).toBe("5.5%");
  });
});
