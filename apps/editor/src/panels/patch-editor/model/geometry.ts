/**
 * Patch editor geometry: readable viewports and the far-zoom level of detail here; rects, cable
 * curves and node sizes come from the shared graph model in @sonobe/core/graph, measured with the
 * editor's own fonts.
 */

import { estimateNodeSize as estimateWith, type NodeSize, type Rect } from "@sonobe/core/graph";
import { nodeTextMeasurer } from "./measure.ts";
import type { GraphNodeData } from "./types.ts";

export {
  boundsOf,
  cableControlOffset,
  cablePath,
  cablePoint,
  COMMENT_PADDING,
  createPlacementIndex,
  HEADER_HEIGHT,
  NODE_MIN_WIDTH,
  padRect,
  PLACEMENT_PADDING,
  pointInRect,
  portCenterY,
  rectContains,
  rectsOverlap,
  roundPosition,
  ROW_HEIGHT,
  sampleCable,
  type PlacementIndex,
  type Point,
  type Rect,
} from "@sonobe/core/graph";

export interface ViewportLike {
  x: number;
  y: number;
  zoom: number;
}

/** A size estimate before the DOM measures a node (tidy up, placement), in the editor's fonts. */
export function estimateNodeSize(data: GraphNodeData): NodeSize {
  return estimateWith(data, { measure: nodeTextMeasurer() });
}

/**
 * Below this zoom, node text is a few pixels tall: the patch editor stops painting port labels, values
 * and icons (their boxes stay, so handles and cables don't move). A fitted graph of hundreds of nodes
 * otherwise makes every repaint anywhere in the window pay for tens of thousands of text runs.
 */
export const FAR_ZOOM = 0.35;

export const isFarZoom = (zoom: number): boolean => zoom < FAR_ZOOM;

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
