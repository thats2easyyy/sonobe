import { describe, expect, it } from "vitest";
import { boundsVisible, estimateNodeSize, readableViewport } from "./geometry.ts";

const pad = { top: 20, right: 20, bottom: 20, left: 20 };

describe("readableViewport", () => {
  it("fits and centers a graph that stays readable", () => {
    const vp = readableViewport({ x: 0, y: 0, width: 400, height: 200 }, 840, 440, { padding: pad });
    expect(vp.zoom).toBe(1);
    expect(vp.x).toBe(220);
    expect(vp.y).toBe(120);
    expect(boundsVisible({ x: 0, y: 0, width: 400, height: 200 }, vp, 840, 440)).toBe(true);
  });

  it("zooms out to fit when the result is still readable", () => {
    const vp = readableViewport({ x: 100, y: 100, width: 1000, height: 400 }, 840, 440, { padding: pad });
    expect(vp.zoom).toBeCloseTo(0.8);
    expect(boundsVisible({ x: 100, y: 100, width: 1000, height: 400 }, vp, 840, 440)).toBe(true);
  });

  it("keeps a readable zoom and shows the graph from its left edge instead of shrinking it", () => {
    const bounds = { x: 20, y: 0, width: 960, height: 610 };
    const vp = readableViewport(bounds, 500, 320, { padding: pad, readableZoom: 0.65 });
    expect(vp.zoom).toBe(0.65);
    expect(bounds.x * vp.zoom + vp.x).toBe(20);
    expect(bounds.y * vp.zoom + vp.y).toBe(20);
    expect(boundsVisible(bounds, vp, 500, 320)).toBe(false);
  });
});

describe("estimateNodeSize", () => {
  it("sizes nodes from what they show", () => {
    expect(estimateNodeSize({ kind: "comment" })).toEqual({ width: 240, height: 120 });
    expect(estimateNodeSize({ kind: "patch", title: "Switch", collapsed: true })).toEqual({ width: 120, height: 28 });
    expect(estimateNodeSize({ kind: "patch", title: "Switch", inputs: [{ name: "Flip" }, { name: "Turn On" }], outputs: [{ name: "On" }] }).height).toBe(28 + 2 * 22 + 6);
  });
});
