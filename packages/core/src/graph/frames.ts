/**
 * Comment frames as sections of the graph: which frame a node belongs to, and a frame's rect around
 * its nodes. A node belongs to the innermost frame under its title bar's leading edge, so a node that
 * grew past its frame's edge still belongs to it.
 */

import type { Rect } from "./geometry.ts";
import { HEADER_HEIGHT } from "./nodeSize.ts";

/** Room a tidied frame keeps around its nodes, with space for its title on top. */
export const FRAME_PADDING = { top: 44, right: 20, bottom: 20, left: 20 } as const;

/** The smallest frame the patch editor resizes to. */
export const FRAME_MIN_SIZE = { width: 180, height: 80 } as const;

/** The point on a node's title bar that decides its frame: 24 pt in from its leading edge (less for narrow nodes). */
export function titleAnchor(rect: Rect): [number, number] {
  return [rect.x + Math.min(24, rect.width / 2), rect.y + HEADER_HEIGHT / 2];
}

const contains = (r: Rect, [x, y]: readonly [number, number]) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/** Every frame under the node's title anchor. */
export function framesAt<F extends Rect>(rect: Rect, frames: readonly F[]): F[] {
  const anchor = titleAnchor(rect);
  return frames.filter((f) => contains(f, anchor));
}

/** The innermost (smallest) frame under the node's title anchor. */
export function homeFrame<F extends Rect>(rect: Rect, frames: readonly F[]): F | undefined {
  let best: F | undefined;
  for (const f of framesAt(rect, frames)) if (!best || f.width * f.height < best.width * best.height) best = f;
  return best;
}

/** The frame a frame sits in: the innermost larger frame under its title anchor. */
export function parentFrame<F extends Rect & { id: string }>(frame: F, frames: readonly F[]): F | undefined {
  return homeFrame(frame, frames.filter((o) => o.id !== frame.id && o.width * o.height > frame.width * frame.height));
}

/**
 * Everything a frame holds: the nodes whose home frame is it or a frame inside it, and those inner
 * frames. What moves with the frame when it's dragged; Tidy Up lays each part out in its own frame.
 */
export function frameContents<F extends Rect & { id: string }, N extends Rect>(frameId: string, frames: readonly F[], nodes: readonly N[]): { nodes: N[]; frames: F[] } {
  const parent = new Map(frames.map((f) => [f.id, parentFrame(f, frames)?.id]));
  const within = (id: string | undefined) => {
    for (let p = id, depth = 0; p !== undefined && depth <= frames.length; p = parent.get(p), depth++) if (p === frameId) return true;
    return false;
  };
  return { nodes: nodes.filter((n) => within(homeFrame(n, frames)?.id)), frames: frames.filter((f) => f.id !== frameId && within(parent.get(f.id))) };
}

/** The rect of a frame around `rects` with room for its title; undefined for none. */
export function fitFrame(rects: readonly Rect[], padding: { top: number; right: number; bottom: number; left: number } = FRAME_PADDING, min: { width: number; height: number } = FRAME_MIN_SIZE): Rect | undefined {
  if (rects.length === 0) return undefined;
  const x = Math.min(...rects.map((r) => r.x)) - padding.left;
  const y = Math.min(...rects.map((r) => r.y)) - padding.top;
  const right = Math.max(...rects.map((r) => r.x + r.width)) + padding.right;
  const bottom = Math.max(...rects.map((r) => r.y + r.height)) + padding.bottom;
  return { x, y, width: Math.max(min.width, right - x), height: Math.max(min.height, bottom - y) };
}
