/** Knife cut geometry: which cables a freehand stroke crosses. */

import { sampleCable, type Point } from "./geometry.ts";

const EPS = 1e-9;

function orientation(a: Point, b: Point, c: Point): number {
  const v = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  return Math.abs(v) < EPS ? 0 : v > 0 ? 1 : 2;
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return Math.min(a[0], c[0]) - EPS <= b[0] && b[0] <= Math.max(a[0], c[0]) + EPS && Math.min(a[1], c[1]) - EPS <= b[1] && b[1] <= Math.max(a[1], c[1]) + EPS;
}

/** True when segment p1–p2 touches or crosses segment q1–q2. */
export function segmentsIntersect(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const o1 = orientation(p1, p2, q1);
  const o2 = orientation(p1, p2, q2);
  const o3 = orientation(q1, q2, p1);
  const o4 = orientation(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, q1, p2)) return true;
  if (o2 === 0 && onSegment(p1, q2, p2)) return true;
  if (o3 === 0 && onSegment(q1, p1, q2)) return true;
  if (o4 === 0 && onSegment(q1, p2, q2)) return true;
  return false;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boxOf(points: readonly Point[]): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of points) {
    if (x < box.minX) box.minX = x;
    if (y < box.minY) box.minY = y;
    if (x > box.maxX) box.maxX = x;
    if (y > box.maxY) box.maxY = y;
  }
  return box;
}

const boxesOverlap = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/** True when two polylines cross anywhere. */
export function polylinesIntersect(a: readonly Point[], b: readonly Point[]): boolean {
  if (a.length < 2 || b.length < 2 || !boxesOverlap(boxOf(a), boxOf(b))) return false;
  for (let i = 1; i < a.length; i++) {
    const segBox = boxOf([a[i - 1]!, a[i]!]);
    for (let j = 1; j < b.length; j++) {
      const p = b[j - 1]!;
      const q = b[j]!;
      if (Math.max(p[0], q[0]) < segBox.minX || Math.min(p[0], q[0]) > segBox.maxX || Math.max(p[1], q[1]) < segBox.minY || Math.min(p[1], q[1]) > segBox.maxY) continue;
      if (segmentsIntersect(a[i - 1]!, a[i]!, p, q)) return true;
    }
  }
  return false;
}

export interface CableGeometry {
  id: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

/** Ids of cables the knife stroke crosses (both in the same coordinate space). */
export function cablesCutByKnife(stroke: readonly Point[], cables: Iterable<CableGeometry>, segments = 32): string[] {
  if (stroke.length < 2) return [];
  const strokeBox = boxOf(stroke);
  const cut: string[] = [];
  for (const c of cables) {
    const cableBox = { minX: Math.min(c.sx, c.tx) - 200, minY: Math.min(c.sy, c.ty) - 4, maxX: Math.max(c.sx, c.tx) + 200, maxY: Math.max(c.sy, c.ty) + 4 };
    if (!boxesOverlap(strokeBox, cableBox)) continue;
    if (polylinesIntersect(stroke, sampleCable(c.sx, c.sy, c.tx, c.ty, segments))) cut.push(c.id);
  }
  return cut;
}

/** Drop stroke points closer than `minDistance` to the previous kept point. */
export function simplifyStroke(points: readonly Point[], minDistance = 3): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minDistance) out.push(p);
  }
  if (points.length > 1 && out.at(-1) !== points.at(-1)) out.push(points.at(-1)!);
  return out;
}
