/**
 * Snapping and smart guides: align a moving or resizing rect's edges and center to sibling and
 * artboard lines within a threshold, and measure the gaps to its neighbors. Artboard space.
 */

import type { Point, Rect } from "./geometry.ts";

export type SnapEdge = "start" | "center" | "end";

export interface Guide {
  /** "x": a vertical line at x = `at`. "y": a horizontal line at y = `at`. */
  axis: "x" | "y";
  at: number;
  /** Extent along the other axis. */
  from: number;
  to: number;
}

export interface Measurement {
  /** Axis the distance is measured along. */
  axis: "x" | "y";
  from: Point;
  to: Point;
  value: number;
}

export interface SnapOptions {
  /** Maximum snap distance in points (a screen threshold divided by zoom). */
  threshold: number;
  /** Edges of the moving rect that may snap on each axis. Default: all three. */
  edgesX?: readonly SnapEdge[];
  edgesY?: readonly SnapEdge[];
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

const ALL_EDGES: readonly SnapEdge[] = ["start", "center", "end"];
const ALIGNED = 1e-3;

function edge(r: Rect, axis: "x" | "y", which: SnapEdge): number {
  const start = axis === "x" ? r.x : r.y;
  const size = axis === "x" ? r.width : r.height;
  return which === "start" ? start : which === "center" ? start + size / 2 : start + size;
}

function snapAxis(rect: Rect, targets: readonly Rect[], axis: "x" | "y", edges: readonly SnapEdge[], threshold: number): number | null {
  let best: number | null = null;
  for (const which of edges) {
    const v = edge(rect, axis, which);
    for (const t of targets) {
      for (const candidate of ALL_EDGES) {
        const d = edge(t, axis, candidate) - v;
        if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
      }
    }
  }
  return best;
}

function guidesFor(rect: Rect, targets: readonly Rect[], axis: "x" | "y", edges: readonly SnapEdge[]): Guide[] {
  const other = axis === "x" ? "y" : "x";
  const byLine = new Map<number, Guide>();
  for (const which of edges) {
    const v = edge(rect, axis, which);
    for (const t of targets) {
      if (!ALL_EDGES.some((c) => Math.abs(edge(t, axis, c) - v) < ALIGNED)) continue;
      const key = Math.round(v * 1000) / 1000;
      const from = Math.min(edge(rect, other, "start"), edge(t, other, "start"));
      const to = Math.max(edge(rect, other, "end"), edge(t, other, "end"));
      const existing = byLine.get(key);
      if (existing) {
        existing.from = Math.min(existing.from, from);
        existing.to = Math.max(existing.to, to);
      } else {
        byLine.set(key, { axis, at: v, from, to });
      }
    }
  }
  return [...byLine.values()];
}

/** Snap `rect` to `targets`: the offsets to apply and the guides to draw after applying them. */
export function snapRect(rect: Rect, targets: readonly Rect[], options: SnapOptions): SnapResult {
  const edgesX = options.edgesX ?? ALL_EDGES;
  const edgesY = options.edgesY ?? ALL_EDGES;
  const dx = edgesX.length ? snapAxis(rect, targets, "x", edgesX, options.threshold) : null;
  const dy = edgesY.length ? snapAxis(rect, targets, "y", edgesY, options.threshold) : null;
  const snapped: Rect = { ...rect, x: rect.x + (dx ?? 0), y: rect.y + (dy ?? 0) };
  return {
    dx: dx ?? 0,
    dy: dy ?? 0,
    guides: [...(dx !== null ? guidesFor(snapped, targets, "x", edgesX) : []), ...(dy !== null ? guidesFor(snapped, targets, "y", edgesY) : [])],
  };
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);

/**
 * Gaps from `rect` to the nearest neighbor on each side (neighbors must overlap it on the other
 * axis), falling back to the container's edges when nothing is in the way.
 */
export function measureGaps(rect: Rect, others: readonly Rect[], container: Rect | null): Measurement[] {
  const out: Measurement[] = [];
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;

  const horizontal = (side: "left" | "right") => {
    let best: Rect | null = null;
    let gap = Infinity;
    for (const o of others) {
      if (overlap(rect.y, bottom, o.y, o.y + o.height) <= 0) continue;
      const g = side === "left" ? rect.x - (o.x + o.width) : o.x - right;
      if (g >= -ALIGNED && g < gap) {
        gap = Math.max(0, g);
        best = o;
      }
    }
    if (best) {
      const y = (Math.max(rect.y, best.y) + Math.min(bottom, best.y + best.height)) / 2;
      const edgeX = side === "left" ? best.x + best.width : best.x;
      if (gap > ALIGNED) out.push({ axis: "x", from: side === "left" ? [edgeX, y] : [right, y], to: side === "left" ? [rect.x, y] : [edgeX, y], value: gap });
    } else if (container) {
      const g = side === "left" ? rect.x - container.x : container.x + container.width - right;
      if (g > ALIGNED) out.push({ axis: "x", from: side === "left" ? [container.x, cy] : [right, cy], to: side === "left" ? [rect.x, cy] : [container.x + container.width, cy], value: g });
    }
  };

  const vertical = (side: "top" | "bottom") => {
    let best: Rect | null = null;
    let gap = Infinity;
    for (const o of others) {
      if (overlap(rect.x, right, o.x, o.x + o.width) <= 0) continue;
      const g = side === "top" ? rect.y - (o.y + o.height) : o.y - bottom;
      if (g >= -ALIGNED && g < gap) {
        gap = Math.max(0, g);
        best = o;
      }
    }
    if (best) {
      const x = (Math.max(rect.x, best.x) + Math.min(right, best.x + best.width)) / 2;
      const edgeY = side === "top" ? best.y + best.height : best.y;
      if (gap > ALIGNED) out.push({ axis: "y", from: side === "top" ? [x, edgeY] : [x, bottom], to: side === "top" ? [x, rect.y] : [x, edgeY], value: gap });
    } else if (container) {
      const g = side === "top" ? rect.y - container.y : container.y + container.height - bottom;
      if (g > ALIGNED) out.push({ axis: "y", from: side === "top" ? [cx, container.y] : [cx, bottom], to: side === "top" ? [cx, rect.y] : [cx, container.y + container.height], value: g });
    }
  };

  horizontal("left");
  horizontal("right");
  vertical("top");
  vertical("bottom");
  return out;
}

/**
 * Distances between two rects (hold ⌥ and hover). When `b` contains `a`, distances to its inner
 * edges; otherwise the horizontal and vertical separation.
 */
export function measureBetween(a: Rect, b: Rect): Measurement[] {
  const ar = a.x + a.width;
  const ab = a.y + a.height;
  const br = b.x + b.width;
  const bb = b.y + b.height;
  const contains = (outer: Rect, inner: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
  if (contains(b, a)) return measureGaps(a, [], b);
  if (contains(a, b)) return measureGaps(b, [], a);
  const out: Measurement[] = [];
  const cy = (Math.max(a.y, b.y) + Math.min(ab, bb)) / 2;
  const cx = (Math.max(a.x, b.x) + Math.min(ar, br)) / 2;
  const yLine = overlap(a.y, ab, b.y, bb) > 0 ? cy : a.y + a.height / 2;
  const xLine = overlap(a.x, ar, b.x, br) > 0 ? cx : a.x + a.width / 2;
  if (b.x >= ar) out.push({ axis: "x", from: [ar, yLine], to: [b.x, yLine], value: b.x - ar });
  else if (a.x >= br) out.push({ axis: "x", from: [br, yLine], to: [a.x, yLine], value: a.x - br });
  if (b.y >= ab) out.push({ axis: "y", from: [xLine, ab], to: [xLine, b.y], value: b.y - ab });
  else if (a.y >= bb) out.push({ axis: "y", from: [xLine, bb], to: [xLine, a.y], value: a.y - bb });
  return out;
}

// ---------------------------------------------------------------------------
// Equal spacing
// ---------------------------------------------------------------------------

/** A gap between two neighbors that equals another gap in the same row or column. */
export interface SpacingMark {
  /** Axis the gap runs along: "x" for a horizontal gap between side-by-side rects. */
  axis: "x" | "y";
  /** The gap region: along `axis` from one rect's edge to the next; across it, where the two overlap. */
  rect: Rect;
  value: number;
}

export interface MoveSnapOptions extends SnapOptions {
  /** Also snap to equal gaps between siblings. Default true. */
  spacing?: boolean;
}

export interface MoveSnapResult extends SnapResult {
  /** Equal gaps to draw after applying the offsets. */
  spacing: SpacingMark[];
}

/** Two gaps count as equal within this many points. */
const EQUAL_GAP = 0.01;

const startOf = (r: Rect, axis: "x" | "y") => (axis === "x" ? r.x : r.y);
const sizeOf = (r: Rect, axis: "x" | "y") => (axis === "x" ? r.width : r.height);
const endOf = (r: Rect, axis: "x" | "y") => startOf(r, axis) + sizeOf(r, axis);
const across = (axis: "x" | "y"): "x" | "y" => (axis === "x" ? "y" : "x");
const overlapOn = (a: Rect, b: Rect, axis: "x" | "y") => overlap(startOf(a, axis), endOf(a, axis), startOf(b, axis), endOf(b, axis));

interface GapPair {
  a: Rect;
  b: Rect;
  value: number;
}

/** Rects in `rect`'s row (axis "x") or column (axis "y"): they overlap it across the axis. */
function bandOf(rect: Rect, others: readonly Rect[], axis: "x" | "y"): Rect[] {
  const o = across(axis);
  return others.filter((r) => overlapOn(rect, r, o) > ALIGNED && sizeOf(r, axis) > 0);
}

/** Each band rect and its nearest neighbor after it along the axis (they must overlap each other). */
function adjacentGaps(band: readonly Rect[], axis: "x" | "y"): GapPair[] {
  const o = across(axis);
  const out: GapPair[] = [];
  for (const a of band) {
    let best: Rect | null = null;
    for (const b of band) {
      if (b === a || startOf(b, axis) < endOf(a, axis) - ALIGNED || overlapOn(a, b, o) <= ALIGNED) continue;
      if (!best || startOf(b, axis) < startOf(best, axis)) best = b;
    }
    if (best) out.push({ a, b: best, value: Math.max(0, startOf(best, axis) - endOf(a, axis)) });
  }
  return out;
}

/** Nearest band rect before `rect` along the axis (within `slop`), and the nearest one after it. */
function neighbors(rect: Rect, band: readonly Rect[], axis: "x" | "y", slop: number): { before: Rect | null; after: Rect | null } {
  let before: Rect | null = null;
  let after: Rect | null = null;
  for (const r of band) {
    if (endOf(r, axis) <= startOf(rect, axis) + slop && startOf(r, axis) < startOf(rect, axis)) {
      if (!before || endOf(r, axis) > endOf(before, axis)) before = r;
    }
    if (startOf(r, axis) >= endOf(rect, axis) - slop && endOf(r, axis) > endOf(rect, axis)) {
      if (!after || startOf(r, axis) < startOf(after, axis)) after = r;
    }
  }
  return { before, after };
}

/**
 * The offset along `axis` that puts `rect` at an equal gap: centered between its two neighbors, or
 * as far from one neighbor as two other siblings in its row are from each other. Null when none is
 * within `threshold`.
 */
export function snapSpacingAxis(rect: Rect, others: readonly Rect[], axis: "x" | "y", threshold: number): number | null {
  const band = bandOf(rect, others, axis);
  if (band.length < 2) return null;
  const { before, after } = neighbors(rect, band, axis, threshold);
  if (!before && !after) return null;
  const size = sizeOf(rect, axis);
  const current = startOf(rect, axis);
  const candidates: number[] = [];
  if (before && after) {
    const free = startOf(after, axis) - endOf(before, axis) - size;
    if (free > ALIGNED) candidates.push(endOf(before, axis) + free / 2);
  }
  for (const gap of adjacentGaps(band, axis)) {
    if (gap.a === before && gap.b === after) continue;
    if (gap.value <= ALIGNED) continue;
    if (before) candidates.push(endOf(before, axis) + gap.value);
    if (after) candidates.push(startOf(after, axis) - gap.value - size);
  }
  let best: number | null = null;
  for (const target of candidates) {
    const d = target - current;
    if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best;
}

function gapRect(a: Rect, b: Rect, axis: "x" | "y"): Rect {
  const o = across(axis);
  const from = Math.max(startOf(a, o), startOf(b, o));
  const to = Math.min(endOf(a, o), endOf(b, o));
  const start = endOf(a, axis);
  const length = startOf(b, axis) - start;
  return axis === "x" ? { x: start, y: from, width: length, height: to - from } : { x: from, y: start, width: to - from, height: length };
}

/** Equal gaps around `rect` in its row or column (at least two of them), for drawing. */
export function spacingMarks(rect: Rect, others: readonly Rect[], axis: "x" | "y"): SpacingMark[] {
  const band = bandOf(rect, others, axis);
  if (band.length === 0) return [];
  const { before, after } = neighbors(rect, band, axis, ALIGNED);
  const own: GapPair[] = [];
  if (before) own.push({ a: before, b: rect, value: startOf(rect, axis) - endOf(before, axis) });
  if (after) own.push({ a: rect, b: after, value: startOf(after, axis) - endOf(rect, axis) });
  const pairs = adjacentGaps(band, axis).filter((g) => !(g.a === before && g.b === after));
  const marks = new Map<string, SpacingMark>();
  const add = (g: GapPair) => {
    const r = gapRect(g.a, g.b, axis);
    const key = `${Math.round(r.x * 100)}:${Math.round(r.y * 100)}:${Math.round(r.width * 100)}:${Math.round(r.height * 100)}`;
    if (!marks.has(key)) marks.set(key, { axis, rect: r, value: g.value });
  };
  for (const gap of own) {
    if (gap.value <= ALIGNED) continue;
    const equal = [...own.filter((g) => g !== gap), ...pairs].filter((g) => g.value > ALIGNED && Math.abs(g.value - gap.value) < EQUAL_GAP);
    if (equal.length === 0) continue;
    add(gap);
    for (const g of equal) add(g);
  }
  return [...marks.values()];
}

/**
 * Snap a moving rect: per axis, the nearer of edge alignment (to `targets`) and equal spacing (among
 * `others`), with the alignment guides and equal-gap marks to draw after applying the offsets.
 */
export function snapMove(rect: Rect, targets: readonly Rect[], others: readonly Rect[], options: MoveSnapOptions): MoveSnapResult {
  const edgesX = options.edgesX ?? ALL_EDGES;
  const edgesY = options.edgesY ?? ALL_EDGES;
  const spacing = options.spacing !== false;
  const axisOffset = (axis: "x" | "y", edges: readonly SnapEdge[]): number | null => {
    if (edges.length === 0) return null;
    const align = snapAxis(rect, targets, axis, edges, options.threshold);
    const space = spacing ? snapSpacingAxis(rect, others, axis, options.threshold) : null;
    if (align === null) return space;
    if (space === null) return align;
    return Math.abs(space) < Math.abs(align) - ALIGNED ? space : align;
  };
  const dx = axisOffset("x", edgesX);
  const dy = axisOffset("y", edgesY);
  const snapped: Rect = { ...rect, x: rect.x + (dx ?? 0), y: rect.y + (dy ?? 0) };
  return {
    dx: dx ?? 0,
    dy: dy ?? 0,
    guides: [...(dx !== null ? guidesFor(snapped, targets, "x", edgesX) : []), ...(dy !== null ? guidesFor(snapped, targets, "y", edgesY) : [])],
    spacing: spacing ? [...(edgesX.length ? spacingMarks(snapped, others, "x") : []), ...(edgesY.length ? spacingMarks(snapped, others, "y") : [])] : [],
  };
}

/** True when a gap measurement draws the same gap as a spacing mark. */
export function measurementMatchesMark(m: Measurement, mark: SpacingMark): boolean {
  if (m.axis !== mark.axis || Math.abs(m.value - mark.value) > EQUAL_GAP) return false;
  const i = m.axis === "x" ? 0 : 1;
  const lo = Math.min(m.from[i]!, m.to[i]!);
  return Math.abs(lo - startOf(mark.rect, mark.axis)) < EQUAL_GAP;
}

/** Label text for a measurement: whole points without decimals, otherwise one decimal. */
export function formatMeasurement(value: number): string {
  const r = Math.round(value * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
