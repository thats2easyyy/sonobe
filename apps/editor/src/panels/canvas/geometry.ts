/**
 * Canvas geometry: points, rects, and quads in artboard space (prototype points, Y down), plus
 * helpers over SceneNode world transforms (4x4 column-major).
 */

import { mat4, type SceneNode } from "@sonobe/engine";

export type Point = [number, number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Corners in layer-local order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export const IDENTITY_MATRIX: readonly number[] = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

const EPS = 1e-9;

/** Map a point (z = 0) through a matrix with perspective divide. */
export function transformPoint(m: readonly number[], p: readonly number[]): Point {
  const [x, y] = mat4.transformPoint(m, [p[0] ?? 0, p[1] ?? 0]);
  return [x, y];
}

/** Map a point back onto the matrix's z = 0 plane; null when edge-on or scaled to zero. */
export function inverseTransformPoint(m: readonly number[], p: readonly number[]): Point | null {
  const inv = mat4.planeInverse(m);
  if (!inv) return null;
  const [x, y] = mat4.transformPoint(inv, [p[0] ?? 0, p[1] ?? 0]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

/** Corners of the local box [0, width] × [0, height] through `m`. */
export function quadOf(m: readonly number[], width: number, height: number): Quad {
  return [transformPoint(m, [0, 0]), transformPoint(m, [width, 0]), transformPoint(m, [width, height]), transformPoint(m, [0, height])];
}

export function nodeQuad(node: Pick<SceneNode, "worldTransform" | "width" | "height">): Quad {
  return quadOf(node.worldTransform, node.width, node.height);
}

export function boundsOf(points: readonly (readonly number[])[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const x = p[0] ?? 0;
    const y = p[1] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  return boundsOf(rects.flatMap((r) => [[r.x, r.y], [r.x + r.width, r.y + r.height]]));
}

/** Where two rects overlap, or null when they don't (touching edges don't count). */
export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** Normalized rect spanning two points. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) };
}

export function rectCenter(r: Rect): Point {
  return [r.x + r.width / 2, r.y + r.height / 2];
}

export function rectContains(r: Rect, p: Point, slop = 0): boolean {
  return p[0] >= r.x - slop && p[0] <= r.x + r.width + slop && p[1] >= r.y - slop && p[1] <= r.y + r.height + slop;
}

/** Inclusive overlap test (touching edges count). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Point inside a convex quad (either winding; edges count). */
export function pointInQuad(q: Quad, p: Point): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const c = cross(q[i]!, q[(i + 1) % 4]!, p);
    if (Math.abs(c) < EPS) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when a (possibly rotated) quad overlaps a rect. */
export function quadIntersectsRect(q: Quad, r: Rect): boolean {
  if (!rectsIntersect(boundsOf(q), r)) return false;
  if (q.some((p) => rectContains(r, p))) return true;
  const corners: Quad = [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]];
  if (corners.some((p) => pointInQuad(q, p))) return true;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) if (segmentsIntersect(q[i]!, q[(i + 1) % 4]!, corners[j]!, corners[(j + 1) % 4]!)) return true;
  }
  return false;
}

/** True when an artboard point falls inside a node's box (expanded by `slop` local points). */
export function nodeContainsPoint(node: Pick<SceneNode, "worldTransform" | "width" | "height">, p: Point, slop = 0): boolean {
  const local = inverseTransformPoint(node.worldTransform, p);
  if (!local) return false;
  return local[0] >= Math.min(0, node.width) - slop && local[0] <= Math.max(0, node.width) + slop && local[1] >= Math.min(0, node.height) - slop && local[1] <= Math.max(0, node.height) + slop;
}

/** Z rotation of a matrix's 2D part in degrees (clockwise positive, Y down). */
export function rotationDegrees(m: readonly number[]): number {
  return (Math.atan2(m[1]!, m[0]!) * 180) / Math.PI;
}

/** No rotation, skew, or perspective (scale and translation allowed). */
export function isAxisAligned(m: readonly number[], epsilon = 1e-6): boolean {
  return Math.abs(m[1]!) < epsilon && Math.abs(m[4]!) < epsilon && Math.abs(m[3]!) < epsilon && Math.abs(m[7]!) < epsilon;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Round to a step without float noise or -0. */
export function roundTo(value: number, step = 1): number {
  if (!Number.isFinite(value) || step <= 0) return value;
  const r = Number((Math.round(value / step) * step).toFixed(6));
  return Object.is(r, -0) ? 0 : r;
}

/** Angle in (-180, 180]. */
export function normalizeAngle(degrees: number): number {
  let a = degrees % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return Object.is(a, -0) ? 0 : a;
}
