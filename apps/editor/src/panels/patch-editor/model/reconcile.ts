/**
 * Merge freshly derived nodes into the React Flow node state: keep measured sizes (so nodes don't
 * re-measure and flash), keep positions of nodes being dragged, apply selection, and reuse node
 * objects that didn't change so React Flow skips them.
 */

import type { FlowNode } from "./types.ts";

export interface ReconcileState {
  selected: ReadonlySet<string>;
  /** Nodes mid-drag keep their local position. */
  dragging: ReadonlySet<string>;
  /** Session position overrides (e.g. comment children following a comment drag). */
  overrides?: ReadonlyMap<string, { x: number; y: number }>;
}

export function reconcileNodes(previous: readonly FlowNode[], next: readonly FlowNode[], state: ReconcileState): FlowNode[] {
  const prevById = new Map(previous.map((n) => [n.id, n]));
  let changed = previous.length !== next.length;
  const out = next.map((n, i) => {
    const p = prevById.get(n.id);
    const selected = state.selected.has(n.id);
    const dragging = state.dragging.has(n.id);
    const override = state.overrides?.get(n.id);
    const position = dragging && p ? p.position : (override ?? n.position);
    if (
      p &&
      p.type === n.type &&
      p.data === n.data &&
      p.width === n.width &&
      p.height === n.height &&
      p.zIndex === n.zIndex &&
      (p.selected ?? false) === selected &&
      p.position.x === position.x &&
      p.position.y === position.y
    ) {
      if (previous[i] !== p) changed = true;
      return p;
    }
    changed = true;
    const merged = { ...n, position, selected } as FlowNode;
    if (p?.measured && p.type === n.type) merged.measured = p.measured;
    if (p?.dragging) merged.dragging = p.dragging;
    return merged;
  });
  return changed ? out : (previous as FlowNode[]);
}
