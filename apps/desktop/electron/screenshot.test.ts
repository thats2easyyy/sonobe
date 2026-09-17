import { describe, expect, it } from "vitest";
import { intersectRects, isRect, isViewerBounds, screenshotSize, toCaptureRect, viewerCaptureRect } from "./screenshot.ts";

describe("screenshot geometry", () => {
  it("captures the part of the stage the viewer container shows", () => {
    const bounds = { x: 300, y: 80, width: 420, height: 700, stage: { x: 310, y: 60, width: 402, height: 874 }, scale: 1, devicePixelRatio: 2, prototypeSize: [402, 874] };
    expect(isViewerBounds(bounds)).toBe(true);
    expect(viewerCaptureRect(bounds as Parameters<typeof viewerCaptureRect>[0])).toEqual({ x: 310, y: 80, width: 402, height: 700 });
    expect(intersectRects({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 5, height: 5 })).toBeNull();
    expect(isViewerBounds({ x: 0, y: 0, width: 1, height: 1 })).toBe(false);
    expect(isRect({ x: 0, y: 0, width: Number.NaN, height: 1 })).toBe(false);
  });

  it("sizes images in prototype points × scale, capped by maxWidth", () => {
    const rect = { x: 0, y: 0, width: 201, height: 437 };
    expect(screenshotSize(rect, 0.5)).toEqual({ width: 402, height: 874 });
    expect(screenshotSize(rect, 0.5, 2)).toEqual({ width: 804, height: 1748 });
    expect(screenshotSize(rect, 0.5, 2, 800)).toEqual({ width: 800, height: 1739 });
    expect(screenshotSize({ x: 0, y: 0, width: 0.2, height: 0.2 }, 1)).toEqual({ width: 1, height: 1 });
  });

  it("converts CSS pixels to window DIPs and clips to the page", () => {
    expect(toCaptureRect({ x: 10, y: 20, width: 100, height: 50 }, 1.5)).toEqual({ x: 15, y: 30, width: 150, height: 75 });
    expect(toCaptureRect({ x: 10, y: 20, width: 100, height: 50 }, 1.5, { width: 160, height: 100 })).toEqual({ x: 15, y: 30, width: 145, height: 70 });
    expect(toCaptureRect({ x: -10, y: -10, width: 5, height: 5 }, 1)).toBeNull();
  });
});
