/**
 * Hit testing over a SceneFrame: front to back, through each node's world transform, with
 * touches bubbling to ancestors. See ARCHITECTURE.md §5.5 and docs/research/semantics.md §8.3.
 *
 * `worldTransform` maps a node's local space (origin at its top-left, in points) to prototype
 * coordinates, so a node's bounds are [0, width] × [0, height] in local space.
 */

import { axisScales, planeInverse, transformPoint } from "../math/matrix.ts";
import type { SceneNode } from "../types.ts";

/** Layers at or below this opacity are treated as invisible to touches. */
export const HIT_OPACITY_EPSILON = 1e-5;

/** True when the node itself can be a touch target or receive bubbled touches. */
export function isInteractive(node: SceneNode): boolean {
  return node.props.hitTest !== false && node.type !== "colorFill";
}

/** Whether the node and its subtree are drawn and touchable at all. */
function isTouchable(node: SceneNode): boolean {
  return node.visible && node.props.enabled !== false && node.opacity > HIT_OPACITY_EPSILON;
}

/** Point in the node's local coordinates, or null when the node is edge-on or scaled to zero. */
export function toLocalPoint(node: SceneNode, x: number, y: number): [number, number] | null {
  const inv = planeInverse(node.worldTransform);
  if (!inv) return null;
  const [lx, ly] = transformPoint(inv, [x, y]);
  return Number.isFinite(lx) && Number.isFinite(ly) ? [lx, ly] : null;
}

/** True when (x, y) in prototype coordinates falls inside the node, expanded by `slop` points. */
export function containsPoint(node: SceneNode, x: number, y: number, slop = 0): boolean {
  const local = toLocalPoint(node, x, y);
  if (!local) return false;
  let slopX = 0;
  let slopY = 0;
  if (slop > 0) {
    const [sx, sy] = axisScales(node.worldTransform);
    slopX = sx > 0 ? slop / sx : 0;
    slopY = sy > 0 ? slop / sy : 0;
  }
  const minX = Math.min(0, node.width) - slopX;
  const maxX = Math.max(0, node.width) + slopX;
  const minY = Math.min(0, node.height) - slopY;
  const maxY = Math.max(0, node.height) + slopY;
  return local[0] >= minX && local[0] <= maxX && local[1] >= minY && local[1] <= maxY;
}

/** Siblings front-most first: higher zPosition wins, then later in the list. */
function frontToBack(nodes: readonly SceneNode[]): SceneNode[] {
  let layered = false;
  for (const n of nodes) {
    if (typeof n.props.zPosition === "number" && n.props.zPosition !== 0) {
      layered = true;
      break;
    }
  }
  const order = nodes.map((node, index) => ({ node, index }));
  if (layered) {
    const z = (n: SceneNode) =>
      typeof n.props.zPosition === "number" && Number.isFinite(n.props.zPosition)
        ? n.props.zPosition
        : 0;
    order.sort((a, b) => z(a.node) - z(b.node) || a.index - b.index);
  }
  const out: SceneNode[] = [];
  for (let i = order.length - 1; i >= 0; i--) out.push(order[i]!.node);
  return out;
}

function visit(node: SceneNode, x: number, y: number): SceneNode[] | null {
  if (!isTouchable(node)) return null;
  if (node.clip && !containsPoint(node, x, y)) return null;
  for (const child of frontToBack(node.children)) {
    const chain = visit(child, x, y);
    if (chain) {
      if (isInteractive(node)) chain.push(node);
      return chain;
    }
  }
  if (!isInteractive(node)) return null;
  const slop =
    typeof node.props.hitSlop === "number" && node.props.hitSlop > 0 ? node.props.hitSlop : 0;
  return containsPoint(node, x, y, slop) ? [node] : null;
}

/**
 * Hit test at (x, y) in prototype coordinates. Returns the front-most target first, then its
 * interactive ancestors (bubbling), or an empty array. Skips hidden, disabled, and fully
 * transparent subtrees and anything outside a clipping ancestor. Layers with `hitTest: false`
 * and Color Fills let touches pass through but their children can still be hit.
 */
export function hitTest(roots: readonly SceneNode[], x: number, y: number): SceneNode[] {
  for (const root of frontToBack(roots)) {
    const chain = visit(root, x, y);
    if (chain) return chain;
  }
  return [];
}
