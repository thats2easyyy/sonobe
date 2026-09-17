/** Patch editor geometry: node size estimates, cable curves, and rect helpers. */

import type { GraphNodeData } from "./types.ts";

export const NODE_MIN_WIDTH = 164;
export const HEADER_HEIGHT = 28;
export const ROW_HEIGHT = 22;
export const NODE_FOOTER = 6;
export const COMMENT_PADDING = { top: 36, right: 20, bottom: 20, left: 20 } as const;

export type Point = readonly [number, number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CHAR_W = 6.4;

/** A size estimate before the DOM measures a node (tidy up, placement). */
export function estimateNodeSize(data: GraphNodeData): { width: number; height: number } {
  if (data.kind === "comment") return { width: 240, height: 120 };
  if (data.kind === "patch" && data.collapsed) return { width: Math.max(120, 44 + data.title.length * 7), height: HEADER_HEIGHT };
  const rows = Math.max(data.inputs.length, data.outputs.length, 1);
  const longestIn = data.inputs.reduce((n, p) => Math.max(n, p.name.length), 0);
  const longestOut = data.outputs.reduce((n, p) => Math.max(n, p.name.length), 0);
  const title = data.kind === "patch" ? data.title.length : data.title.length + 4;
  const width = Math.max(NODE_MIN_WIDTH, 48 + title * 7, 40 + (longestIn + longestOut) * CHAR_W + 56);
  return { width: Math.round(Math.min(width, 320)), height: HEADER_HEIGHT + rows * ROW_HEIGHT + NODE_FOOTER };
}

/** Horizontal control-point distance for a cable. */
export function cableControlOffset(sx: number, tx: number): number {
  const dx = tx - sx;
  return dx >= 0 ? Math.max(36, dx * 0.5) : Math.max(60, Math.min(160, -dx * 0.5));
}

/** SVG path for a cable from an output (sx, sy) into an input (tx, ty). */
export function cablePath(sx: number, sy: number, tx: number, ty: number): string {
  const c = cableControlOffset(sx, tx);
  return `M ${sx} ${sy} C ${sx + c} ${sy}, ${tx - c} ${ty}, ${tx} ${ty}`;
}

/** Point on the cable curve at t in [0, 1]. */
export function cablePoint(t: number, sx: number, sy: number, tx: number, ty: number): [number, number] {
  const c = cableControlOffset(sx, tx);
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return [a * sx + b * (sx + c) + d * (tx - c) + e * tx, a * sy + b * sy + d * ty + e * ty];
}

/** The cable as a polyline of `segments` pieces. */
export function sampleCable(sx: number, sy: number, tx: number, ty: number, segments = 24): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= segments; i++) out.push(cablePoint(i / segments, sx, sy, tx, ty));
  return out;
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function pointInRect([x, y]: Point, r: Rect, inset = 0): boolean {
  return x >= r.x - inset && x <= r.x + r.width + inset && y >= r.y - inset && y <= r.y + r.height + inset;
}

/** Bounding box of rects, grown by padding; undefined for none. */
export function boundsOf(rects: readonly Rect[], padding: { top: number; right: number; bottom: number; left: number } = { top: 0, right: 0, bottom: 0, left: 0 }): Rect | undefined {
  if (rects.length === 0) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX - padding.left, y: minY - padding.top, width: maxX - minX + padding.left + padding.right, height: maxY - minY + padding.top + padding.bottom };
}

export const roundPosition = (n: number): number => Math.round(n);
