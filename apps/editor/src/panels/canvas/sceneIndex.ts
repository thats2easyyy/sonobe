/**
 * Canvas scene queries over the design-time SceneFrame of one component: which document layer a
 * scene node edits, editor hit testing (front to back, clipping respected, hidden and locked layers
 * passed through), the click-select rules, marquee selection, and layout flow info.
 */

import type { Component, Id, LayerNode } from "@sonobe/core";
import type { SceneFrame, SceneNode } from "@sonobe/engine";
import { paintOrder } from "@sonobe/engine";
import { nodeContainsPoint, nodeQuad, quadIntersectsRect, unionRects, boundsOf, type Point, type Rect } from "./geometry.ts";

export type FlowLayout = "row" | "column" | "grid";

export interface LayerEntry {
  id: Id;
  layer: LayerNode;
  parentId: Id | null;
  /** Index among the parent's children (document order, back to front). */
  index: number;
  depth: number;
  /** Locked itself or through an ancestor. */
  locked: boolean;
  /** Disabled itself or through an ancestor, or not drawn. */
  hidden: boolean;
  /** Every scene node drawn for this layer (one per loop copy). */
  nodes: SceneNode[];
  /** The unreplicated node, or copy #0. */
  node: SceneNode | undefined;
}

export interface CanvasIndex {
  readonly scene: SceneFrame | null;
  readonly component: Component | undefined;
  readonly entries: ReadonlyMap<Id, LayerEntry>;
  readonly byKey: ReadonlyMap<string, SceneNode>;
  entry(id: Id): LayerEntry | undefined;
  /** Children of a layer (null: the component root) in document order. */
  children(parentId: Id | null): readonly LayerEntry[];
  /** The component layer a scene node edits (the instance, for nodes inside component instances). */
  layerIdForKey(key: string): Id | undefined;
  /** World transform of a layer's parent node; null at the component root. */
  parentWorld(id: Id): readonly number[] | null;
  /** Artboard bounds of every copy of a layer, or null when it isn't drawn. */
  bounds(id: Id): Rect | null;
  /** Resolved layout of a layer's parent when the layer flows in it; null when positioned by Position. */
  flowLayout(id: Id): FlowLayout | null;
}

/** Scene key → layer id at the component level: "card#2" → "card", "inst#1/inner" → "inst". */
export function sceneKeyLayerId(key: string): string {
  const head = key.split("/")[0] ?? key;
  return head.replace(/#\d+$/, "");
}

const EMPTY: readonly LayerEntry[] = [];

export function buildCanvasIndex(component: Component | undefined, scene: SceneFrame | null): CanvasIndex {
  const entries = new Map<Id, LayerEntry>();
  const childLists = new Map<Id | null, LayerEntry[]>();
  const byKey = new Map<string, SceneNode>();

  const walk = (layers: readonly LayerNode[], parentId: Id | null, depth: number, locked: boolean, hidden: boolean) => {
    const list: LayerEntry[] = [];
    childLists.set(parentId, list);
    layers.forEach((layer, index) => {
      const entry: LayerEntry = { id: layer.id, layer, parentId, index, depth, locked: locked || !!layer.locked, hidden: hidden || layer.props.enabled === false, nodes: [], node: undefined };
      entries.set(layer.id, entry);
      list.push(entry);
      if (layer.children?.length) walk(layer.children, layer.id, depth + 1, entry.locked, entry.hidden);
    });
  };
  walk(component?.layers ?? [], null, 0, false, false);

  const visit = (nodes: readonly SceneNode[]) => {
    for (const node of nodes) {
      byKey.set(node.key, node);
      if (!node.key.includes("/")) {
        const entry = entries.get(sceneKeyLayerId(node.key));
        if (entry && node.layerId === entry.id) entry.nodes.push(node);
      }
      if (node.children.length) visit(node.children);
    }
  };
  if (scene) visit(scene.roots);

  for (const entry of entries.values()) {
    entry.node = entry.nodes.find((n) => n.key === entry.id) ?? entry.nodes.find((n) => n.key === `${entry.id}#0`) ?? entry.nodes[0];
    const parentHidden = entry.parentId !== null && (entries.get(entry.parentId)?.hidden ?? false);
    entry.hidden = entry.hidden || parentHidden || entry.nodes.length === 0 || entry.nodes.every((n) => !n.visible);
  }

  const index: CanvasIndex = {
    scene,
    component,
    entries,
    byKey,
    entry: (id) => entries.get(id),
    children: (parentId) => childLists.get(parentId) ?? EMPTY,
    layerIdForKey(key) {
      const id = sceneKeyLayerId(key);
      return entries.has(id) ? id : undefined;
    },
    parentWorld(id) {
      const node = entries.get(id)?.node;
      const parent = node?.parentKey ? byKey.get(node.parentKey) : undefined;
      return parent ? parent.worldTransform : null;
    },
    bounds(id) {
      const nodes = entries.get(id)?.nodes ?? [];
      return unionRects(nodes.map((n) => boundsOf(nodeQuad(n))));
    },
    flowLayout(id) {
      const entry = entries.get(id);
      const node = entry?.node;
      if (!entry || !node || entry.layer.type === "colorFill" || node.props.positioning === "absolute" || !node.visible) return null;
      const parent = node.parentKey ? byKey.get(node.parentKey) : undefined;
      const layout = parent?.props.layout;
      return layout === "row" || layout === "column" || layout === "grid" ? layout : null;
    },
  };
  return index;
}

function alphaOf(v: unknown): number {
  return v && typeof v === "object" && typeof (v as { a?: unknown }).a === "number" ? (v as { a: number }).a : 0;
}

/** Whether clicking the node's own box (not a child) selects it. */
function isSurface(node: SceneNode): boolean {
  if (node.type === "colorFill") return false;
  if (node.type === "group") return alphaOf(node.props.color) > 0 || (typeof node.props.strokeWidth === "number" && node.props.strokeWidth > 0);
  return true;
}

/** The front-most scene node a click at an artboard point lands on (see hitLayers). */
function hitNode(index: CanvasIndex, p: Point): SceneNode | null {
  const scene = index.scene;
  if (!scene) return null;
  const visit = (siblings: readonly SceneNode[]): SceneNode | null => {
    // Front to back in the order the viewer draws them (zPosition first, then layer order).
    const nodes = paintOrder(siblings);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i]!;
      if (!node.visible) continue;
      const id = index.layerIdForKey(node.key);
      if (id && index.entry(id)?.locked) continue;
      const inside = nodeContainsPoint(node, p);
      if (node.clip && !inside) continue;
      const child = node.children.length ? visit(node.children) : null;
      if (child) return child;
      if (inside && isSurface(node)) return node;
    }
    return null;
  };
  return visit(scene.roots);
}

/**
 * Editable layers under an artboard point: the front-most hit first, then its ancestors. Hidden and
 * locked layers pass clicks through; transparent groups are hit only through their children.
 */
export function hitLayers(index: CanvasIndex, p: Point): Id[] {
  const hit = hitNode(index, p);
  const chain: Id[] = [];
  for (let node: SceneNode | undefined = hit ?? undefined; node; node = node.parentKey ? index.byKey.get(node.parentKey) : undefined) {
    const id = index.layerIdForKey(node.key);
    if (id && chain.at(-1) !== id && !chain.includes(id)) chain.push(id);
  }
  return chain;
}

/** Which loop copy of `layerId` a click at an artboard point lands on ("card#2" → 2); undefined when the layer isn't looped. */
export function hitCopy(index: CanvasIndex, p: Point, layerId: Id): number | undefined {
  for (let node: SceneNode | undefined = hitNode(index, p) ?? undefined; node; node = node.parentKey ? index.byKey.get(node.parentKey) : undefined) {
    if (index.layerIdForKey(node.key) !== layerId) continue;
    const copy = /#(\d+)$/.exec(node.key.split("/")[0] ?? "");
    return copy ? Number(copy[1]) : undefined;
  }
  return undefined;
}

/**
 * The layer a click selects from a hit chain (deepest first). ⌘ (`deep`) picks the deepest layer.
 * Otherwise it stays at the level of the current selection (clicking a sibling selects the sibling)
 * and falls back to the top-level ancestor.
 */
export function pickLayer(chain: readonly Id[], index: CanvasIndex, selected: readonly Id[], deep: boolean): Id | null {
  if (chain.length === 0) return null;
  if (deep) return chain[0]!;
  const contexts = new Set<Id | null>();
  for (const id of selected) {
    const entry = index.entry(id);
    if (entry) contexts.add(entry.parentId);
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const entry = index.entry(chain[i]!);
    if (entry && contexts.has(entry.parentId)) return entry.id;
  }
  return chain.at(-1)!;
}

/** The member of a hit chain whose parent is `parentId` (double-click to go one level deeper). */
export function pickChildOf(chain: readonly Id[], index: CanvasIndex, parentId: Id): Id | null {
  return chain.find((id) => index.entry(id)?.parentId === parentId) ?? null;
}

export interface MarqueeOptions {
  /** Select the deepest layers instead of top-level ones (⌘). */
  deep?: boolean;
}

/** Layers whose drawn box overlaps an artboard rect, in document order. */
export function marqueeLayers(index: CanvasIndex, rect: Rect, options: MarqueeOptions = {}): Id[] {
  const out: Id[] = [];
  const selectable = (e: LayerEntry) => !e.locked && !e.hidden && e.layer.type !== "colorFill" && e.nodes.length > 0;
  for (const entry of index.entries.values()) {
    if (!selectable(entry)) continue;
    if (options.deep) {
      if (index.children(entry.id).some(selectable)) continue;
    } else if (entry.parentId !== null) {
      continue;
    }
    if (entry.nodes.some((n) => quadIntersectsRect(nodeQuad(n), rect))) out.push(entry.id);
  }
  return out;
}

/** True when a layer can be dragged or resized on the canvas at all. */
export function isEditableLayer(index: CanvasIndex, id: Id): boolean {
  const entry = index.entry(id);
  return !!entry && !entry.locked && !!entry.node && entry.layer.type !== "colorFill";
}
