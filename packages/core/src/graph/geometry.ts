/** Patch graph geometry: rects, cable curves, and a placement index. */

export type Point = readonly [number, number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Room a comment frame keeps around the nodes inside it (a title bar on top). */
export const COMMENT_PADDING = { top: 36, right: 20, bottom: 20, left: 20 } as const;

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

/** Room kept around placed nodes when auto-placing layer and interface nodes. */
export const PLACEMENT_PADDING = 12;

/** Placed rects, each grown by a padding, answering "does this rect overlap any of them?" */
export interface PlacementIndex {
  add(rect: Rect): void;
  /** True when `rect` overlaps a placed rect grown by the padding (like rectsOverlap(padRect(placed, padding), rect)). */
  overlaps(rect: Rect): boolean;
}

const PLACEMENT_CELL = 256;
/** Rects spanning more cells than this per axis go in a list checked one by one. */
const MAX_CELL_SPAN = 64;

/**
 * A uniform grid of padded rects, so a placement search checks only nearby nodes instead of every
 * placed node for every candidate spot. Answers exactly like checking every rect.
 */
export function createPlacementIndex(padding: number): PlacementIndex {
  const cells = new Map<number, Map<number, Rect[]>>();
  const loose: Rect[] = [];
  const span = (r: Rect) => {
    const x0 = Math.floor(r.x / PLACEMENT_CELL);
    const y0 = Math.floor(r.y / PLACEMENT_CELL);
    const x1 = Math.floor((r.x + r.width) / PLACEMENT_CELL);
    const y1 = Math.floor((r.y + r.height) / PLACEMENT_CELL);
    const indexed = Number.isFinite(x0 + y0 + x1 + y1) && x1 - x0 <= MAX_CELL_SPAN && y1 - y0 <= MAX_CELL_SPAN;
    return indexed ? { x0, y0, x1, y1 } : null;
  };
  return {
    add(rect) {
      const padded = padRect(rect, padding);
      const s = span(padded);
      if (!s) {
        loose.push(padded);
        return;
      }
      for (let cx = s.x0; cx <= s.x1; cx++) {
        let column = cells.get(cx);
        if (!column) cells.set(cx, (column = new Map()));
        for (let cy = s.y0; cy <= s.y1; cy++) {
          const bucket = column.get(cy);
          if (bucket) bucket.push(padded);
          else column.set(cy, [padded]);
        }
      }
    },
    overlaps(rect) {
      for (const r of loose) if (rectsOverlap(r, rect)) return true;
      const s = span(rect);
      if (!s) {
        for (const column of cells.values()) for (const bucket of column.values()) for (const r of bucket) if (rectsOverlap(r, rect)) return true;
        return false;
      }
      for (let cx = s.x0; cx <= s.x1; cx++) {
        const column = cells.get(cx);
        if (!column) continue;
        for (let cy = s.y0; cy <= s.y1; cy++) {
          const bucket = column.get(cy);
          if (bucket) for (const r of bucket) if (rectsOverlap(r, rect)) return true;
        }
      }
      return false;
    },
  };
}

export function pointInRect([x, y]: Point, r: Rect, inset = 0): boolean {
  return x >= r.x - inset && x <= r.x + r.width + inset && y >= r.y - inset && y <= r.y + r.height + inset;
}

/** Grow (or with a negative amount, shrink) a rect on every side. */
export function padRect(r: Rect, amount: number): Rect {
  return { x: r.x - amount, y: r.y - amount, width: r.width + amount * 2, height: r.height + amount * 2 };
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
