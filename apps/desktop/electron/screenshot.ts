/**
 * Screenshot geometry: which part of the editor window to capture and how big the image should be.
 * Pure functions (no Electron) so the math is testable; capture.ts does the actual capture.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the renderer's `viewer.bounds` handler returns (apps/editor/src/runtime/runtimeHost.ts). */
export interface ViewerBoundsLike extends Rect {
  /** The prototype stage, in viewport CSS pixels (may overflow the container). */
  stage: Rect;
  /** CSS pixels per prototype point. */
  scale: number;
  devicePixelRatio: number;
  prototypeSize: [number, number];
}

export interface Size {
  width: number;
  height: number;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function isRect(value: unknown): value is Rect {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return finite(r.x) && finite(r.y) && finite(r.width) && finite(r.height);
}

export function isViewerBounds(value: unknown): value is ViewerBoundsLike {
  if (!isRect(value)) return false;
  const v = value as unknown as Record<string, unknown>;
  const size = v.prototypeSize;
  return isRect(v.stage) && finite(v.scale) && v.scale > 0 && Array.isArray(size) && size.length === 2 && finite(size[0]) && finite(size[1]);
}

/** Overlap of two rects, or null when they don't overlap. */
export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** The visible part of the prototype stage: the stage clipped to the viewer container. */
export function viewerCaptureRect(bounds: ViewerBoundsLike): Rect | null {
  return intersectRects(bounds.stage, bounds);
}

/**
 * Output size for a capture of `rect` (CSS pixels): points × `scale` (points = CSS px / viewer
 * scale), shrunk to `maxWidth` while keeping the aspect ratio. Never smaller than 1×1.
 */
export function screenshotSize(rect: Rect, cssPerPoint: number, scale = 1, maxWidth?: number): Size {
  const perPoint = cssPerPoint > 0 ? cssPerPoint : 1;
  let width = (rect.width / perPoint) * scale;
  let height = (rect.height / perPoint) * scale;
  if (maxWidth !== undefined && maxWidth > 0 && width > maxWidth) {
    height *= maxWidth / width;
    width = maxWidth;
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/**
 * CSS-pixel rect → integer window rect for `capturePage`, which works in DIPs (CSS px × zoom
 * factor). Clipped to the page size when given; null when nothing is left.
 */
export function toCaptureRect(rect: Rect, zoomFactor: number, page?: Size): Rect | null {
  const zoom = zoomFactor > 0 ? zoomFactor : 1;
  let x = Math.floor(rect.x * zoom);
  let y = Math.floor(rect.y * zoom);
  let right = Math.ceil((rect.x + rect.width) * zoom);
  let bottom = Math.ceil((rect.y + rect.height) * zoom);
  x = Math.max(0, x);
  y = Math.max(0, y);
  if (page) {
    right = Math.min(right, Math.floor(page.width));
    bottom = Math.min(bottom, Math.floor(page.height));
  }
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}
