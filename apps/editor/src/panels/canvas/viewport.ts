/**
 * Canvas viewport math. `screen = artboard × zoom + (x, y)`, where screen is CSS pixels inside the
 * canvas body and artboard is prototype points.
 */

import type { Viewport } from "../../state/selection.ts";
import type { Point, Rect } from "./geometry.ts";

export type { Viewport };

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;
/** Stops for zoom in / zoom out. */
export const ZOOM_STEPS: readonly number[] = [0.02, 0.05, 0.1, 0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function artboardToScreen(vp: Viewport, p: Point): Point {
  return [vp.x + p[0] * vp.zoom, vp.y + p[1] * vp.zoom];
}

export function screenToArtboard(vp: Viewport, p: Point): Point {
  return [(p[0] - vp.x) / vp.zoom, (p[1] - vp.y) / vp.zoom];
}

export function rectToScreen(vp: Viewport, r: Rect): Rect {
  return { x: vp.x + r.x * vp.zoom, y: vp.y + r.y * vp.zoom, width: r.width * vp.zoom, height: r.height * vp.zoom };
}

/** Zoom to `zoom`, keeping the artboard point under `screenPoint` in place. */
export function zoomAt(vp: Viewport, zoom: number, screenPoint: Point): Viewport {
  const next = clampZoom(zoom);
  const [ax, ay] = screenToArtboard(vp, screenPoint);
  return { x: screenPoint[0] - ax * next, y: screenPoint[1] - ay * next, zoom: next };
}

export function panBy(vp: Viewport, dx: number, dy: number): Viewport {
  return { x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom };
}

export interface FitOptions {
  /** Screen pixels kept free around the rect. Default 48. */
  padding?: number;
  /** Never zoom in beyond this. Default 1. */
  maxZoom?: number;
}

/** A viewport that centers `rect` (artboard space) in a container of `size` CSS pixels. */
export function fitRect(rect: Rect, size: readonly [number, number], options: FitOptions = {}): Viewport {
  const padding = options.padding ?? 48;
  const availW = Math.max(1, size[0] - padding * 2);
  const availH = Math.max(1, size[1] - padding * 2);
  const zoom = clampZoom(Math.min(options.maxZoom ?? 1, availW / Math.max(1, rect.width), availH / Math.max(1, rect.height)));
  return { x: (size[0] - rect.width * zoom) / 2 - rect.x * zoom, y: (size[1] - rect.height * zoom) / 2 - rect.y * zoom, zoom };
}

/** The next zoom stop in `direction` (1 = in, -1 = out). */
export function nextZoomStep(zoom: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((s) => s > zoom * 1.001) ?? MAX_ZOOM;
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i]! < zoom / 1.001) return ZOOM_STEPS[i]!;
  return MIN_ZOOM;
}

/** Zoom for a wheel or pinch event (pinch arrives as ctrl+wheel with small deltas). */
export function wheelZoom(vp: Viewport, deltaY: number, screenPoint: Point, deltaMode = 0): Viewport {
  const delta = Math.max(-40, Math.min(40, deltaY * (deltaMode === 1 ? 16 : 1)));
  return zoomAt(vp, vp.zoom * Math.exp(-delta * 0.01), screenPoint);
}

/** Pan so `rect` is on screen (centering it when it isn't); zooms out only when it can't fit. */
export function ensureVisible(vp: Viewport, rect: Rect, size: readonly [number, number], margin = 40): Viewport {
  const s = rectToScreen(vp, rect);
  if (s.x >= margin && s.y >= margin && s.x + s.width <= size[0] - margin && s.y + s.height <= size[1] - margin) return vp;
  if (s.width > size[0] - margin * 2 || s.height > size[1] - margin * 2) return fitRect(rect, size, { padding: margin, maxZoom: vp.zoom });
  return { x: size[0] / 2 - (rect.x + rect.width / 2) * vp.zoom, y: size[1] / 2 - (rect.y + rect.height / 2) * vp.zoom, zoom: vp.zoom };
}

export function formatZoom(zoom: number): string {
  const pct = zoom * 100;
  return `${pct < 10 ? Math.round(pct * 10) / 10 : Math.round(pct)}%`;
}
