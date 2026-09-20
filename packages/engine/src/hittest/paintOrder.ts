/**
 * Paint order: the one rule for which sibling draws, and takes touches, in front. Siblings sort by
 * zPosition, lowest first (back to front); ties keep document order; a missing or non-finite
 * zPosition counts as 0. Only siblings reorder: a child never leaves its parent. This is Core
 * Animation's rule (zPosition first, then position in the sublayers array).
 *
 * SceneFrame children stay in document order, so keys and "first copy" lookups stay stable. Every
 * surface that draws or hit tests applies this order itself: the engine hit test, the DOM and SVG
 * renderers, the renderer's cursor query and the editor's canvas picker.
 */

/** Anything with a zPosition: a SceneNode, or a hand-built node that only sets `props.zPosition`. */
export interface Stackable {
  zPosition?: number;
  props?: { readonly zPosition?: unknown };
}

/** A node's stacking depth among its siblings: `zPosition`, then `props.zPosition`, else 0. */
export function stackDepth(node: Stackable): number {
  const z = node.zPosition ?? node.props?.zPosition;
  return typeof z === "number" && Number.isFinite(z) ? z : 0;
}

/**
 * Indices of `nodes` back to front, or null when document order already is paint order (nothing
 * lifted, or the zPositions already ascend). Stable: equal depths keep their document order.
 */
export function paintIndices(nodes: readonly Stackable[]): number[] | null {
  if (nodes.length < 2) return null;
  let previous = stackDepth(nodes[0]!);
  let ascending = true;
  for (let i = 1; i < nodes.length && ascending; i++) {
    const z = stackDepth(nodes[i]!);
    if (z < previous) ascending = false;
    previous = z;
  }
  if (ascending) return null;
  const depths = nodes.map(stackDepth);
  const order = nodes.map((_, i) => i);
  order.sort((a, b) => depths[a]! - depths[b]! || a - b);
  return order;
}

/** `nodes` back to front. Returns `nodes` itself when nothing is reordered, so most frames allocate nothing. */
export function paintOrder<T extends Stackable>(nodes: readonly T[]): readonly T[] {
  const order = paintIndices(nodes);
  return order ? order.map((i) => nodes[i]!) : nodes;
}
