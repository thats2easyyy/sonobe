import { describe, expect, it } from "vitest";
import {
  approxEqualMat,
  axisScales,
  compose,
  identity,
  invert,
  multiply,
  perspective,
  planeInverse,
  rotationX,
  rotationY,
  rotationZ,
  scaling,
  toCssMatrix3d,
  transformPoint,
  translation,
  type ComposeParams,
} from "./matrix.ts";

function composeReference(p: Required<ComposeParams>): number[] {
  const [w, h] = p.size as number[];
  const left = p.position[0]! - p.anchor[0]! * w!;
  const top = p.position[1]! - p.anchor[1]! * h!;
  const px = p.pivot[0]! * w!;
  const py = p.pivot[1]! * h!;
  const s = typeof p.scale === "number" ? [p.scale, p.scale, p.scale] : p.scale;
  let m = translation(left + px, top + py, p.zPosition);
  m = multiply(m, rotationX(p.rotationX));
  m = multiply(m, rotationY(p.rotationY));
  m = multiply(m, rotationZ(p.rotationZ));
  m = multiply(m, scaling(s[0]!, s[1]!, s[2]!));
  return multiply(m, translation(-px, -py, 0));
}

const cases: Required<ComposeParams>[] = [
  {
    position: [200, 100],
    size: [100, 50],
    anchor: [0.5, 0.5],
    pivot: [0.5, 0.5],
    scale: 1,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    zPosition: 0,
  },
  {
    position: [12, -40],
    size: [320, 180],
    anchor: [0, 1],
    pivot: [0.2, 0.9],
    scale: [1.5, 0.75, 2],
    rotationX: 20,
    rotationY: -35,
    rotationZ: 50,
    zPosition: 12,
  },
  {
    position: [0, 0],
    size: [44, 44],
    anchor: [1, 0],
    pivot: [0, 0],
    scale: 0.3,
    rotationX: -60,
    rotationY: 10,
    rotationZ: 190,
    zPosition: -3,
  },
];

describe("matrix", () => {
  it("identity and multiply", () => {
    const m = compose(cases[1]!);
    expect(multiply(identity(), m)).toEqual(m);
    expect(approxEqualMat(multiply(m, identity()), m)).toBe(true);
    const t = multiply(translation(10, 0), scaling(2, 2));
    expect(transformPoint(t, [5, 5])).toEqual([20, 10, 0]);
  });

  it("compose places the anchor point at position", () => {
    const m = compose({ position: [200, 100], size: [100, 50], anchor: [0.5, 0.5] });
    expect(transformPoint(m, [0, 0])).toEqual([150, 75, 0]);
    expect(transformPoint(m, [50, 25])).toEqual([200, 100, 0]);
    expect(transformPoint(m, [100, 50])).toEqual([250, 125, 0]);
  });

  it("rotates clockwise on screen about the pivot (Y down)", () => {
    const m = compose({ size: [100, 50], rotationZ: 90 });
    const [x, y] = transformPoint(m, [0, 0]);
    expect(x).toBeCloseTo(75, 12);
    expect(y).toBeCloseTo(-25, 12);
    const [cx, cy] = transformPoint(m, [50, 25]);
    expect(cx).toBeCloseTo(50, 12);
    expect(cy).toBeCloseTo(25, 12);
  });

  it("scales about the pivot", () => {
    const m = compose({ position: [10, 10], size: [100, 100], scale: 2, pivot: [0, 0] });
    expect(transformPoint(m, [50, 50])).toEqual([110, 110, 0]);
  });

  it("matches T · Rx · Ry · Rz · S about the pivot", () => {
    for (const c of cases) expect(approxEqualMat(compose(c), composeReference(c), 1e-9)).toBe(true);
  });

  it("invert round-trips", () => {
    for (const c of cases) {
      const m = multiply(perspective(800), compose(c));
      const inv = invert(m)!;
      expect(approxEqualMat(multiply(m, inv), identity(), 1e-9)).toBe(true);
      expect(approxEqualMat(multiply(inv, m), identity(), 1e-9)).toBe(true);
      const p = transformPoint(m, [13, 7, 2]);
      const back = transformPoint(inv, p);
      expect(back[0]).toBeCloseTo(13, 8);
      expect(back[1]).toBeCloseTo(7, 8);
      expect(back[2]).toBeCloseTo(2, 8);
    }
  });

  it("singular matrices have no inverse", () => {
    expect(invert(compose({ size: [10, 10], scale: 0 }))).toBeNull();
    expect(planeInverse(compose({ size: [10, 10], scale: [1, 0, 1] }))).toBeNull();
    expect(planeInverse(compose({ size: [10, 10], rotationY: 90 }))).toBeNull();
  });

  it("planeInverse agrees with invert for 2D transforms", () => {
    const m = compose({
      position: [30, 40],
      size: [80, 20],
      rotationZ: 33,
      scale: [1.2, 0.8, 1],
      zPosition: 5,
    });
    const a = transformPoint(invert(m)!, [55, 61, 5]);
    const b = transformPoint(planeInverse(m)!, [55, 61]);
    expect(b[0]).toBeCloseTo(a[0], 9);
    expect(b[1]).toBeCloseTo(a[1], 9);
  });

  it("planeInverse finds the point on a 3D-rotated layer under the cursor", () => {
    const m = multiply(
      translation(100, 100),
      compose({ size: [200, 100], rotationY: 60, rotationX: 25 }),
    );
    const world = transformPoint(m, [30, 20]);
    const local = transformPoint(planeInverse(m)!, [world[0], world[1]]);
    expect(local[0]).toBeCloseTo(30, 9);
    expect(local[1]).toBeCloseTo(20, 9);
  });

  it("planeInverse handles perspective", () => {
    const m = multiply(
      perspective(500),
      compose({ size: [200, 100], rotationX: 40, zPosition: -30 }),
    );
    const world = transformPoint(m, [150, 80]);
    const local = transformPoint(planeInverse(m)!, [world[0], world[1]]);
    expect(local[0]).toBeCloseTo(150, 8);
    expect(local[1]).toBeCloseTo(80, 8);
  });

  it("axisScales reports on-screen axis lengths", () => {
    const [sx, sy] = axisScales(compose({ size: [10, 10], scale: [2, 3, 1], rotationZ: 45 }));
    expect(sx).toBeCloseTo(2, 12);
    expect(sy).toBeCloseTo(3, 12);
  });

  it("toCssMatrix3d is column-major without -0 or exponents", () => {
    expect(toCssMatrix3d(identity())).toBe(
      "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)",
    );
    expect(toCssMatrix3d(translation(12.5, -3))).toBe(
      "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12.5, -3, 0, 1)",
    );
    const css = toCssMatrix3d(rotationZ(180));
    expect(css).not.toMatch(/-0[,)]/);
    expect(css).not.toMatch(/e-/);
    expect(toCssMatrix3d(rotationX(30))).toContain("0.866025");
  });

  it("rotationY matches CSS rotateY orientation", () => {
    const [x, , z] = transformPoint(rotationY(90), [1, 0, 0]);
    expect(x).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(-1, 12);
  });
});
