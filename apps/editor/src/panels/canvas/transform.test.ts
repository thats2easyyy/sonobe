import { mat4 } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import { transformPoint, type Point } from "./geometry.ts";
import { frameFromProps, frameToParent, localMatrix, mapRect, parentDelta, resizeFrame, resizeRect, rotateFrame, type Handle, type LayerFrame } from "./transform.ts";

const frame = (overrides: Partial<LayerFrame> = {}): LayerFrame => ({
  position: [100, 100],
  size: [200, 100],
  anchor: [0, 0],
  pivot: [0.5, 0.5],
  scale: [1, 1],
  rotation: 0,
  rotationX: 0,
  rotationY: 0,
  ...overrides,
});

const expectPoint = (actual: Point, expected: Point) => {
  expect(actual[0]).toBeCloseTo(expected[0], 6);
  expect(actual[1]).toBeCloseTo(expected[1], 6);
};

/** The parent-space point of a normalized box point, through the engine's own compose. */
const worldOf = (f: LayerFrame, normalized: Point): Point => transformPoint(localMatrix(f), [normalized[0] * f.size[0], normalized[1] * f.size[1]]);

describe("frame math", () => {
  it("matches the engine's compose", () => {
    const f = frame({ anchor: [0.5, 1], rotation: 30, scale: [1.5, 0.5], pivot: [0.2, 0.7] });
    for (const p of [[0, 0], [37, 12], [200, 100]] as Point[]) expectPoint(frameToParent(f, p), transformPoint(localMatrix(f), p));
  });

  it("reads props with defaults and the laid-out size", () => {
    const f = frameFromProps({ position: [5, 6], scale: 2, scaleXYZ: [1, 3, 1], rotation: 12 }, [40, 20]);
    expect(f).toMatchObject({ position: [5, 6], size: [40, 20], anchor: [0, 0], pivot: [0.5, 0.5], scale: [2, 6], rotation: 12 });
  });
});

describe("resizeFrame", () => {
  it("drags the bottom-right corner with a top-left anchor", () => {
    const r = resizeFrame(frame(), "se", [30, 20]);
    expect(r.size).toEqual([230, 120]);
    expect(r.position).toEqual([100, 100]);
  });

  it("drags the top-left corner and moves Position", () => {
    const r = resizeFrame(frame(), "nw", [-10, 15]);
    expect(r.size).toEqual([210, 85]);
    expect(r.position).toEqual([90, 115]);
  });

  it("respects the anchor: a centered anchor moves Position by half", () => {
    const f = frame({ anchor: [0.5, 0.5], position: [200, 150] });
    const r = resizeFrame(f, "e", [40, 999]);
    expect(r.size).toEqual([240, 100]);
    // The left edge (x = 100) stays put, so the center moves right by 20.
    expectPoint(r.position, [220, 150]);
    expectPoint(worldOf({ ...f, ...r }, [0, 0.5]), worldOf(f, [0, 0.5]));
  });

  it("keeps the opposite corner fixed for every handle, anchor, pivot, rotation, and scale", () => {
    const f = frame({ anchor: [0.3, 0.8], pivot: [0.25, 0.6], rotation: 37, scale: [1.2, 0.9], position: [140, 90] });
    const handles: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
    const opposite: Record<Handle, Point> = { nw: [1, 1], n: [0.5, 1], ne: [0, 1], e: [0, 0.5], se: [0, 0], s: [0.5, 0], sw: [1, 0], w: [1, 0.5] };
    for (const handle of handles) {
      const r = resizeFrame(f, handle, [13, -7]);
      expectPoint(worldOf({ ...f, ...r }, opposite[handle]), worldOf(f, opposite[handle]));
    }
  });

  it("follows the pointer along a rotated layer's axes", () => {
    const f = frame({ rotation: 90, anchor: [0, 0] });
    // Rotated 90° clockwise: the local +x axis points down in the parent.
    const r = resizeFrame(f, "e", [0, 50]);
    expect(r.size[0]).toBeCloseTo(250);
    expect(r.size[1]).toBeCloseTo(100);
    expectPoint(worldOf({ ...f, ...r }, [0, 0.5]), worldOf(f, [0, 0.5]));
  });

  it("divides the pointer delta by scale", () => {
    const r = resizeFrame(frame({ scale: [2, 2], pivot: [0, 0] }), "se", [40, 40]);
    expect(r.size).toEqual([220, 120]);
  });

  it("resizes from the center with ⌥", () => {
    const f = frame();
    const r = resizeFrame(f, "se", [10, 10], { fromCenter: true });
    expect(r.size).toEqual([220, 120]);
    expectPoint(worldOf({ ...f, ...r }, [0.5, 0.5]), worldOf(f, [0.5, 0.5]));
  });

  it("keeps the aspect ratio with ⇧ on corners and edges", () => {
    const corner = resizeFrame(frame(), "se", [100, 10], { proportional: true });
    expect(corner.size).toEqual([300, 150]);
    const edge = resizeFrame(frame(), "s", [0, 50], { proportional: true });
    expect(edge.size).toEqual([300, 150]);
    // An edge scales the other axis about its center.
    expectPoint(edge.position, [50, 100]);
  });

  it("clamps to the minimum size instead of flipping", () => {
    const r = resizeFrame(frame(), "e", [-500, 0], { minSize: 1 });
    expect(r.size).toEqual([1, 100]);
    expect(r.position).toEqual([100, 100]);
  });

  it("resizes multi-selection bounds and maps members proportionally", () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const next = resizeRect(bounds, "se", [100, 50]);
    expect(next).toEqual({ x: 0, y: 0, width: 200, height: 150 });
    expect(mapRect({ x: 50, y: 50, width: 50, height: 50 }, bounds, next)).toEqual({ x: 100, y: 75, width: 100, height: 75 });
  });
});

describe("rotateFrame", () => {
  it("adds the angle swept around the center", () => {
    expect(rotateFrame(0, [0, 0], [10, 0], [0, 10])).toBeCloseTo(90);
    expect(rotateFrame(170, [0, 0], [10, 0], [0, 10])).toBeCloseTo(-100);
  });

  it("snaps to 15° with ⇧", () => {
    expect(rotateFrame(0, [0, 0], [10, 0], [10, 3])).toBeCloseTo(16.699, 2);
    expect(rotateFrame(0, [0, 0], [10, 0], [10, 3], { snap: true })).toBe(15);
    expect(rotateFrame(0, [0, 0], [10, 0], [10, 1], { snap: true })).toBe(0);
  });
});

describe("parentDelta", () => {
  it("converts artboard drags into a scaled, rotated parent's space", () => {
    const parent = mat4.compose({ position: [50, 50], size: [100, 100], pivot: [0, 0], scale: 2, rotationZ: 90 });
    const d = parentDelta(parent, [60, 60], [60, 80]);
    // Down 20 on the artboard = +x 10 in a parent rotated 90° and scaled 2×.
    expectPoint(d, [10, 0]);
    expect(parentDelta(null, [1, 2], [4, 6])).toEqual([3, 4]);
  });
});
