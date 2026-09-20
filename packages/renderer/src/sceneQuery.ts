/** Read-only queries over a rendered SceneFrame (hover cursor, overlays). */

import type { SceneFrame, SceneNode } from "@sonobe/engine";
import { paintOrder } from "@sonobe/engine";
import { isMat4, unprojectPoint } from "./matrix.ts";

export interface SceneHit {
  node: SceneNode;
  /** Point in the node's local coordinates. */
  local: [number, number];
}

function containsPoint(node: SceneNode, x: number, y: number): [number, number] | null {
  if (!isMat4(node.worldTransform)) return null;
  const local = unprojectPoint(node.worldTransform, x, y);
  if (!local) return null;
  const slop = typeof node.props?.hitSlop === "number" && node.props.hitSlop > 0 ? node.props.hitSlop : 0;
  const [lx, ly] = local;
  return lx >= -slop && ly >= -slop && lx <= node.width + slop && ly <= node.height + slop ? local : null;
}

function visit(siblings: readonly SceneNode[], x: number, y: number, clipped: boolean): SceneHit[] | null {
  const nodes = paintOrder(siblings);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    if (node.visible === false || node.props?.enabled === false) continue;
    const local = containsPoint(node, x, y);
    if (node.clip && !local) continue;
    const inner = node.children?.length ? visit(node.children, x, y, clipped || node.clip) : null;
    if (inner) return [...inner, { node, local: local ?? [0, 0] }];
    if (local && node.props?.hitTest !== false && node.opacity > 0) return [{ node, local }];
  }
  return null;
}

/**
 * Front-most node under a prototype-space point (in paint order, like the engine's hit test),
 * followed by its ancestors (bubbling order). Skips hidden layers, layers with hitTest off or opacity 0, and respects clipping groups.
 */
export function findNodesAt(frame: SceneFrame, x: number, y: number): SceneHit[] {
  return visit(frame.roots, x, y, false) ?? [];
}

/** CSS cursor for a point: the first non-"auto" `cursor` prop along the hit chain ("" if none). */
export function cursorAt(frame: SceneFrame, x: number, y: number): string {
  for (const hit of findNodesAt(frame, x, y)) {
    const c = hit.node.props?.cursor;
    if (typeof c === "string" && c !== "auto") return c;
  }
  return "";
}
