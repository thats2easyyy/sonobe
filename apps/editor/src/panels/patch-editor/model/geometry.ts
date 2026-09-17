/** Patch editor geometry: node size estimates, cable curves, rect helpers, and readable viewports. */

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

export interface ViewportLike {
  x: number;
  y: number;
  zoom: number;
}

const CHAR_W = 6.4;

/** What a size estimate reads from a node (GraphNodeData, or a patch that doesn't exist yet). */
export interface NodeShape {
  kind: GraphNodeData["kind"];
  title?: string;
  collapsed?: boolean;
  inputs?: readonly { name: string }[];
  outputs?: readonly { name: string }[];
}

/** A size estimate before the DOM measures a node (tidy up, placement). */
export function estimateNodeSize(data: NodeShape): { width: number; height: number } {
  if (data.kind === "comment") return { width: 240, height: 120 };
  const titleLength = data.title?.length ?? 0;
  if (data.kind === "patch" && data.collapsed) return { width: Math.max(120, 44 + titleLength * 7), height: HEADER_HEIGHT };
  const inputs = data.inputs ?? [];
  const outputs = data.outputs ?? [];
  const rows = Math.max(inputs.length, outputs.length, 1);
  const longestIn = inputs.reduce((n, p) => Math.max(n, p.name.length), 0);
  const longestOut = outputs.reduce((n, p) => Math.max(n, p.name.length), 0);
  const title = data.kind === "patch" ? titleLength : titleLength + 4;
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

/**
 * Below this zoom, node text is a few pixels tall: the patch editor stops painting port labels, values
 * and icons (their boxes stay, so handles and cables don't move). A fitted graph of hundreds of nodes
 * otherwise makes every repaint anywhere in the window pay for tens of thousands of text runs.
 */
export const FAR_ZOOM = 0.35;

export const isFarZoom = (zoom: number): boolean => zoom < FAR_ZOOM;

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

export interface ReadableViewportOptions {
  /** Screen-space room kept around the graph (floating toolbar above, zoom controls below). */
  padding?: { top: number; right: number; bottom: number; left: number };
  /** Never zoom in past this. Default 1. */
  maxZoom?: number;
  /** Never zoom out past this. Default 0.1. */
  minZoom?: number;
  /**
   * Below this zoom, text gets hard to read: keep this zoom and show the graph from its top-left
   * corner (flows read left to right) instead of shrinking everything to fit. Default 0.65.
   */
  readableZoom?: number;
}

const DEFAULT_PADDING = { top: 52, right: 40, bottom: 52, left: 36 } as const;

/** React Flow fitView padding with the same room as a readable fit: the top bar above, zoom controls below. */
export const FIT_VIEW_PADDING = { top: `${DEFAULT_PADDING.top}px`, right: `${DEFAULT_PADDING.right}px`, bottom: `${DEFAULT_PADDING.bottom}px`, left: `${DEFAULT_PADDING.left}px` } as const;

/** A viewport that shows `bounds` in a `width` × `height` canvas: fit and centered, or readable from the top-left. */
export function readableViewport(bounds: Rect, width: number, height: number, options: ReadableViewportOptions = {}): ViewportLike {
  const pad = options.padding ?? DEFAULT_PADDING;
  const maxZoom = options.maxZoom ?? 1;
  const minZoom = options.minZoom ?? 0.1;
  const readable = Math.min(options.readableZoom ?? 0.65, maxZoom);
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = Math.max(1, height - pad.top - pad.bottom);
  const fit = Math.min(innerW / Math.max(1, bounds.width), innerH / Math.max(1, bounds.height));
  let zoom = Math.min(maxZoom, Math.max(minZoom, fit));
  if (zoom >= readable) {
    return { x: pad.left + (innerW - bounds.width * zoom) / 2 - bounds.x * zoom, y: pad.top + (innerH - bounds.height * zoom) / 2 - bounds.y * zoom, zoom };
  }
  zoom = readable;
  const fitsVertically = bounds.height * zoom <= innerH;
  return {
    x: pad.left - bounds.x * zoom,
    y: fitsVertically ? pad.top + (innerH - bounds.height * zoom) / 2 - bounds.y * zoom : pad.top - bounds.y * zoom,
    zoom,
  };
}

/** True when `bounds` (flow coordinates) is entirely on screen in a `width` × `height` canvas. */
export function boundsVisible(bounds: Rect, viewport: ViewportLike, width: number, height: number, tolerance = 4): boolean {
  const left = bounds.x * viewport.zoom + viewport.x;
  const top = bounds.y * viewport.zoom + viewport.y;
  const right = left + bounds.width * viewport.zoom;
  const bottom = top + bounds.height * viewport.zoom;
  return left >= -tolerance && top >= -tolerance && right <= width + tolerance && bottom <= height + tolerance;
}
