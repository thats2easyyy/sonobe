import { mat4 } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import {
  boundsOf,
  intersectRects,
  inverseTransformPoint,
  isAxisAligned,
  nodeContainsPoint,
  normalizeAngle,
  pointInQuad,
  quadIntersectsRect,
  quadOf,
  rectFromPoints,
  rectsIntersect,
  rotationDegrees,
  roundTo,
  unionRects,
  type Quad,
} from "./geometry.ts";

const rotated45 = () => mat4.compose({ position: [100, 100], size: [100, 100], pivot: [0.5, 0.5], rotationZ: 45 });

describe("canvas geometry", () => {
  it("maps local corners through a world transform and back", () => {
    const m = mat4.compose({ position: [10, 20], size: [40, 30], scale: 2, pivot: [0, 0] });
    const q = quadOf(m, 40, 30);
    expect(q[0]).toEqual([10, 20]);
    expect(q[2]).toEqual([90, 80]);
    expect(inverseTransformPoint(m, [90, 80])).toEqual([40, 30]);
  });

  it("returns null for a degenerate (zero scale) transform", () => {
    const m = mat4.compose({ position: [0, 0], size: [10, 10], scale: 0 });
    expect(inverseTransformPoint(m, [5, 5])).toBeNull();
  });

  it("bounds and unions rects", () => {
    expect(boundsOf([[3, 4], [-1, 10], [8, 2]])).toEqual({ x: -1, y: 2, width: 9, height: 8 });
    expect(unionRects([{ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: -5, width: 5, height: 5 }])).toEqual({ x: 0, y: -5, width: 25, height: 15 });
    expect(unionRects([])).toBeNull();
    expect(rectFromPoints([10, 10], [0, 30])).toEqual({ x: 0, y: 10, width: 10, height: 20 });
  });

  it("tests rect overlap inclusively", () => {
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 10, width: 5, height: 5 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10.5, y: 0, width: 5, height: 5 })).toBe(false);
  });

  it("intersects rects, with nothing where they only touch or miss", () => {
    const artboard = { x: 0, y: 0, width: 402, height: 874 };
    expect(intersectRects(artboard, { x: 200, y: -20, width: 402, height: 874 })).toEqual({ x: 200, y: 0, width: 202, height: 854 });
    expect(intersectRects(artboard, { x: -10, y: -10, width: 1000, height: 1000 })).toEqual(artboard);
    expect(intersectRects(artboard, { x: 402, y: 0, width: 402, height: 874 })).toBeNull();
    expect(intersectRects(artboard, { x: 482, y: 0, width: 402, height: 874 })).toBeNull();
  });

  it("hit tests rotated quads", () => {
    const q = quadOf(rotated45(), 100, 100);
    // The center is inside; the unrotated top-left corner region is outside the diamond.
    expect(pointInQuad(q, [150, 150])).toBe(true);
    expect(pointInQuad(q, [102, 102])).toBe(false);
    expect(nodeContainsPoint({ worldTransform: rotated45(), width: 100, height: 100 }, [150, 150])).toBe(true);
    expect(nodeContainsPoint({ worldTransform: rotated45(), width: 100, height: 100 }, [102, 102])).toBe(false);
  });

  it("intersects quads with marquee rects through edges, corners, and containment", () => {
    const q = quadOf(rotated45(), 100, 100);
    // A small rect in the empty corner of the rotated square's bounds doesn't touch it.
    expect(quadIntersectsRect(q, { x: 95, y: 95, width: 10, height: 10 })).toBe(false);
    // A rect crossing one edge.
    expect(quadIntersectsRect(q, { x: 140, y: 70, width: 20, height: 20 })).toBe(true);
    // A rect fully inside the quad (no quad vertex inside it).
    expect(quadIntersectsRect(q, { x: 145, y: 145, width: 10, height: 10 })).toBe(true);
    // A rect containing the whole quad.
    expect(quadIntersectsRect(q, { x: 0, y: 0, width: 400, height: 400 })).toBe(true);
    const axis: Quad = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(quadIntersectsRect(axis, { x: 20, y: 20, width: 5, height: 5 })).toBe(false);
  });

  it("reads rotation and axis alignment", () => {
    expect(rotationDegrees(rotated45())).toBeCloseTo(45);
    expect(isAxisAligned(rotated45())).toBe(false);
    expect(isAxisAligned(mat4.compose({ position: [5, 5], size: [10, 10], scale: 3 }))).toBe(true);
  });

  it("rounds without float noise and normalizes angles", () => {
    expect(roundTo(0.1 + 0.2, 0.01)).toBe(0.3);
    expect(roundTo(-0.0001, 0.01)).toBe(0);
    expect(roundTo(12.5, 1)).toBe(13);
    expect(normalizeAngle(270)).toBe(-90);
    expect(normalizeAngle(-180)).toBe(180);
    expect(normalizeAngle(720)).toBe(0);
  });
});
