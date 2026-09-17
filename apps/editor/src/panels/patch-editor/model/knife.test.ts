// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { cablePath, cablePoint, sampleCable } from "./geometry.ts";
import { cablesCutByKnife, polylinesIntersect, segmentsIntersect, simplifyStroke } from "./knife.ts";

describe("segmentsIntersect", () => {
  it("detects crossings, touches, and collinear overlap", () => {
    expect(segmentsIntersect([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true);
    expect(segmentsIntersect([0, 0], [10, 0], [5, 0], [5, 5])).toBe(true);
    expect(segmentsIntersect([0, 0], [10, 0], [5, 0], [15, 0])).toBe(true);
  });

  it("rejects parallel and disjoint segments", () => {
    expect(segmentsIntersect([0, 0], [10, 0], [0, 1], [10, 1])).toBe(false);
    expect(segmentsIntersect([0, 0], [1, 1], [2, 2], [3, 5])).toBe(false);
    expect(segmentsIntersect([0, 0], [10, 0], [11, 0], [20, 0])).toBe(false);
  });
});

describe("cable geometry", () => {
  it("starts and ends at the ports with horizontal tangents", () => {
    expect(cablePoint(0, 10, 20, 300, 80)).toEqual([10, 20]);
    expect(cablePoint(1, 10, 20, 300, 80)).toEqual([300, 80]);
    expect(cablePath(0, 0, 100, 50)).toMatch(/^M 0 0 C /);
    const points = sampleCable(0, 0, 200, 100, 10);
    expect(points).toHaveLength(11);
    expect(points[1]![1]).toBeLessThan(10);
  });
});

describe("cablesCutByKnife", () => {
  const cables = [
    { id: "a", sx: 0, sy: 0, tx: 200, ty: 0 },
    { id: "b", sx: 0, sy: 100, tx: 200, ty: 200 },
    { id: "c", sx: 400, sy: 0, tx: 600, ty: 0 },
  ];

  it("cuts every cable a stroke crosses", () => {
    expect(cablesCutByKnife([[100, -20], [100, 40]], cables)).toEqual(["a"]);
    expect(cablesCutByKnife([[100, -20], [100, 260]], cables)).toEqual(["a", "b"]);
  });

  it("follows the curve, not the straight line between ports", () => {
    // b bows: at x=40 it's still near y≈105, far from the straight line's y≈120.
    const nearStart = sampleCable(0, 100, 200, 200, 64).find(([x]) => x >= 40)!;
    expect(cablesCutByKnife([[40, nearStart[1] - 3], [40, nearStart[1] + 3]], cables)).toEqual(["b"]);
    expect(cablesCutByKnife([[40, 118], [40, 124]], cables)).toEqual([]);
  });

  it("cuts backward cables that loop around", () => {
    const back = { id: "back", sx: 300, sy: 0, tx: 0, ty: 100 };
    const mid = sampleCable(300, 0, 0, 100, 32)[16]!;
    expect(cablesCutByKnife([[mid[0] - 5, mid[1] - 5], [mid[0] + 5, mid[1] + 5]], [back])).toEqual(["back"]);
  });

  it("ignores strokes that miss or are too short", () => {
    expect(cablesCutByKnife([[300, -50], [300, 50]], cables)).toEqual([]);
    expect(cablesCutByKnife([[100, -20]], cables)).toEqual([]);
  });

  it("handles freehand strokes and simplifies them", () => {
    const stroke = simplifyStroke([[90, -10], [91, -9], [95, 5], [100, 10], [110, 12]]);
    expect(stroke.length).toBeLessThan(5);
    expect(polylinesIntersect(stroke, [[0, 0], [200, 0]])).toBe(true);
  });
});
