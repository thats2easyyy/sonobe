/**
 * Selection chrome in screen space: the selection box, resize handles, the rotation knob, what the
 * pointer is over, and the matching cursors.
 */

import type { Id } from "@sonobe/core";
import { distance, pointInQuad, rotationDegrees, transformPoint, unionRects, type Point, type Quad, type Rect } from "./geometry.ts";
import type { CanvasIndex } from "./sceneIndex.ts";
import { HANDLE_POINTS, HANDLES, type Handle } from "./transform.ts";
import { artboardToScreen, type Viewport } from "./viewport.ts";

export interface SelectionChrome {
  /** The framed layer for a single selection; null for a multi-selection. */
  single: Id | null;
  /** Screen corners in layer order: top-left, top-right, bottom-right, bottom-left. */
  quad: Quad;
  handles: { handle: Handle; point: Point }[];
  /** Rotation knob above the top edge (single layers only). */
  knob: { point: Point; base: Point } | null;
  /** On-screen rotation in degrees. */
  angle: number;
  /** Artboard bounds. */
  bounds: Rect;
  /** "W × H" in points. */
  sizeLabel: string;
}

export interface ChromeOptions {
  resizable: boolean;
  rotatable: boolean;
}

const KNOB_OFFSET = 22;
/** Below this on-screen side length only corner handles show. */
const MIN_EDGE_HANDLES = 28;

const fmt = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

export function selectionChrome(index: CanvasIndex, ids: readonly Id[], viewport: Viewport, options: ChromeOptions): SelectionChrome | null {
  const drawn = ids.filter((id) => index.entry(id)?.node);
  if (drawn.length === 0) return null;

  if (drawn.length === 1) {
    const entry = index.entry(drawn[0]!)!;
    const node = entry.node!;
    const toScreen = (local: Point) => artboardToScreen(viewport, transformPoint(node.worldTransform, local));
    const quad: Quad = [toScreen([0, 0]), toScreen([node.width, 0]), toScreen([node.width, node.height]), toScreen([0, node.height])];
    const minSide = Math.min(distance(quad[0], quad[1]), distance(quad[1], quad[2]));
    const handles = options.resizable
      ? HANDLES.filter((h) => h.length === 2 || minSide >= MIN_EDGE_HANDLES).map((handle) => ({ handle, point: toScreen([HANDLE_POINTS[handle][0] * node.width, HANDLE_POINTS[handle][1] * node.height]) }))
      : [];
    let knob: SelectionChrome["knob"] = null;
    if (options.rotatable) {
      const base = toScreen([node.width / 2, 0]);
      const center = toScreen([node.width / 2, node.height / 2]);
      let dx = base[0] - center[0];
      let dy = base[1] - center[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) {
        dx = 0;
        dy = -1;
      } else {
        dx /= len;
        dy /= len;
      }
      knob = { base, point: [base[0] + dx * KNOB_OFFSET, base[1] + dy * KNOB_OFFSET] };
    }
    return { single: entry.id, quad, handles, knob, angle: rotationDegrees(node.worldTransform), bounds: index.bounds(entry.id)!, sizeLabel: `${fmt(node.width)} × ${fmt(node.height)}` };
  }

  const bounds = unionRects(drawn.map((id) => index.bounds(id)).filter((b): b is Rect => b !== null))!;
  const [x0, y0] = artboardToScreen(viewport, [bounds.x, bounds.y]);
  const [x1, y1] = artboardToScreen(viewport, [bounds.x + bounds.width, bounds.y + bounds.height]);
  const quad: Quad = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const handles = options.resizable ? HANDLES.map((handle) => ({ handle, point: [x0 + (x1 - x0) * HANDLE_POINTS[handle][0], y0 + (y1 - y0) * HANDLE_POINTS[handle][1]] as Point })) : [];
  return { single: null, quad, handles, knob: null, angle: 0, bounds, sizeLabel: `${fmt(bounds.width)} × ${fmt(bounds.height)}` };
}

export type ChromeHit = { kind: "resize"; handle: Handle } | { kind: "rotate" };

/** What part of the chrome a screen point is over: handles first, then the knob, then the rotate zones just outside corners. */
export function hitChrome(chrome: SelectionChrome, p: Point, tolerance = 6): ChromeHit | null {
  let best: { handle: Handle; d: number } | null = null;
  for (const h of chrome.handles) {
    const d = distance(h.point, p);
    if (d <= tolerance && (!best || d < best.d)) best = { handle: h.handle, d };
  }
  if (best) return { kind: "resize", handle: best.handle };
  if (!chrome.knob) return null;
  if (distance(chrome.knob.point, p) <= tolerance + 2) return { kind: "rotate" };
  if (!pointInQuad(chrome.quad, p) && chrome.quad.some((corner) => distance(corner, p) <= tolerance + 14)) return { kind: "rotate" };
  return null;
}

const HANDLE_ANGLES: Readonly<Record<Handle, number>> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };

/** CSS resize cursor for a handle on a box rotated by `angle` degrees. */
export function resizeCursor(handle: Handle, angle: number): string {
  const a = (((HANDLE_ANGLES[handle] + angle) % 180) + 180) % 180;
  if (a < 22.5 || a >= 157.5) return "ew-resize";
  if (a < 67.5) return "nwse-resize";
  if (a < 112.5) return "ns-resize";
  return "nesw-resize";
}

const ROTATE_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
  "<g fill='none' stroke-linecap='round' stroke-linejoin='round'>" +
  "<path d='M7 16.5A6.5 6.5 0 1 0 8.2 7' stroke='#fff' stroke-width='4.5'/><path d='M8.5 3v4.5H4' stroke='#fff' stroke-width='4.5'/>" +
  "<path d='M7 16.5A6.5 6.5 0 1 0 8.2 7' stroke='#111' stroke-width='1.6'/><path d='M8.5 3v4.5H4' stroke='#111' stroke-width='1.6'/>" +
  "</g></svg>";

/** Cursor shown over the rotate knob and corner zones. */
export const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(ROTATE_SVG)}") 12 12, crosshair`;
