/**
 * Pure tree helpers behind TreeView: flattening visible rows (the basis for virtualization),
 * resolving drag-and-drop targets, and immutable moves with structural sharing.
 */

export interface TreeNodeLike<T> {
  id: string;
  children?: readonly T[];
}

export interface FlatTreeRow<T> {
  node: T;
  id: string;
  depth: number;
  parentId: string | null;
  /** Index within the parent's children. */
  index: number;
  /** Sibling count (for aria-setsize). */
  setSize: number;
  hasChildren: boolean;
  expanded: boolean;
}

/** Visible rows in display order: a node's children follow it only when it is expanded. */
export function flattenTree<T extends TreeNodeLike<T>>(nodes: readonly T[], expanded: ReadonlySet<string>): FlatTreeRow<T>[] {
  const rows: FlatTreeRow<T>[] = [];
  const visit = (list: readonly T[], depth: number, parentId: string | null) => {
    list.forEach((node, index) => {
      const hasChildren = (node.children?.length ?? 0) > 0;
      const isExpanded = hasChildren && expanded.has(node.id);
      rows.push({ node, id: node.id, depth, parentId, index, setSize: list.length, hasChildren, expanded: isExpanded });
      if (isExpanded && node.children) visit(node.children, depth + 1, node.id);
    });
  };
  visit(nodes, 0, null);
  return rows;
}

export type DropPlacement = "before" | "after" | "inside";

export interface TreeDropTarget {
  parentId: string | null;
  /** Insertion index among the parent's current children (before removing dragged nodes). */
  index: number;
  rowId: string;
  placement: DropPlacement;
  /** Indentation depth for the drop indicator. */
  depth: number;
}

/** Placement from the pointer's vertical position within a row (0 = top, 1 = bottom). */
export function placementFromOffset(fraction: number, canNest: boolean): DropPlacement {
  if (canNest) {
    if (fraction < 0.25) return "before";
    if (fraction > 0.75) return "after";
    return "inside";
  }
  return fraction < 0.5 ? "before" : "after";
}

/**
 * Where a drop on `rows[rowIndex]` lands. Returns null when the row is a dragged node or inside
 * one (a node can't be dropped into its own subtree). Dropping "after" an expanded parent inserts
 * as its first child, matching what the indicator shows.
 */
export function resolveDropTarget<T extends TreeNodeLike<T>>(
  rows: readonly FlatTreeRow<T>[],
  rowIndex: number,
  placement: DropPlacement,
  draggedIds: ReadonlySet<string>,
): TreeDropTarget | null {
  const row = rows[rowIndex];
  if (!row) return null;
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (let cursor: FlatTreeRow<T> | undefined = row; cursor; cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined) {
    if (draggedIds.has(cursor.id)) return null;
  }
  if (placement === "inside") {
    return { parentId: row.id, index: row.node.children?.length ?? 0, rowId: row.id, placement, depth: row.depth + 1 };
  }
  if (placement === "after" && row.expanded && row.hasChildren) {
    return { parentId: row.id, index: 0, rowId: row.id, placement, depth: row.depth + 1 };
  }
  return {
    parentId: row.parentId,
    index: placement === "before" ? row.index : row.index + 1,
    rowId: row.id,
    placement,
    depth: row.depth,
  };
}

export function findTreeNode<T extends TreeNodeLike<T>>(nodes: readonly T[], id: string): T | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = node.children ? findTreeNode(node.children, id) : undefined;
    if (found) return found;
  }
  return undefined;
}

/** Ids from the root down to (not including) the node, or null if not found. */
export function getAncestorIds<T extends TreeNodeLike<T>>(nodes: readonly T[], id: string): string[] | null {
  for (const node of nodes) {
    if (node.id === id) return [];
    if (node.children) {
      const path = getAncestorIds(node.children, id);
      if (path) return [node.id, ...path];
    }
  }
  return null;
}

/**
 * Move nodes (with their subtrees) to `target`. Nodes whose ancestor is also moving travel with
 * that ancestor. Moving a node into its own subtree is a no-op. Untouched branches keep identity.
 */
export function moveTreeNodes<T extends TreeNodeLike<T>>(
  nodes: readonly T[],
  ids: readonly string[],
  target: { parentId: string | null; index: number },
  withChildren: (node: T, children: T[]) => T,
): T[] {
  const moving = new Set(ids);
  if (target.parentId !== null) {
    const path = getAncestorIds(nodes, target.parentId);
    if (!path || moving.has(target.parentId) || path.some((id) => moving.has(id))) return [...nodes];
  }

  const extracted: T[] = [];
  let insertIndex = target.index;

  const remove = (list: readonly T[], parentId: string | null): readonly T[] => {
    let changed = false;
    const out: T[] = [];
    list.forEach((node, i) => {
      if (moving.has(node.id)) {
        extracted.push(node);
        if (parentId === target.parentId && i < target.index) insertIndex--;
        changed = true;
        return;
      }
      if (node.children && node.children.length > 0) {
        const kids = remove(node.children, node.id);
        if (kids !== node.children) {
          out.push(withChildren(node, [...kids]));
          changed = true;
          return;
        }
      }
      out.push(node);
    });
    return changed ? out : list;
  };

  const splice = (list: readonly T[]): T[] => {
    const copy = [...list];
    copy.splice(Math.max(0, Math.min(insertIndex, copy.length)), 0, ...extracted);
    return copy;
  };

  const insert = (list: readonly T[]): readonly T[] => {
    let changed = false;
    const out = list.map((node) => {
      if (node.id === target.parentId) {
        changed = true;
        return withChildren(node, splice(node.children ?? []));
      }
      if (node.children && node.children.length > 0) {
        const kids = insert(node.children);
        if (kids !== node.children) {
          changed = true;
          return withChildren(node, [...kids]);
        }
      }
      return node;
    });
    return changed ? out : list;
  };

  const stripped = remove(nodes, null);
  if (extracted.length === 0) return [...nodes];
  return target.parentId === null ? splice(stripped) : [...insert(stripped)];
}
