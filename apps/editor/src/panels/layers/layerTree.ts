/**
 * Pure helpers behind the Layers panel: the front-first display tree, name and type filtering,
 * turning TreeView drops into moveLayer ops, where inserted layers go, and which patches use a layer.
 */

import {
  deviceScreenSize,
  findLayer,
  isLayerInput,
  isLinkInput,
  parseAddress,
  type Component,
  type Id,
  type InputValue,
  type LayerNode,
  type NewLayer,
  type Op,
  type Registry,
  type SonobeDocument,
} from "@sonobe/core";
import { findTreeNode, moveTreeNodes } from "../../ui/lib/treeModel.ts";

const displayed = new WeakMap<LayerNode, LayerNode>();

/**
 * The layer tree front-most first at every level, the way designers read a layer list (documents
 * store layers back → front). Display nodes are cached per document node, so unchanged branches
 * keep their identity across edits.
 */
export function displayTree(layers: readonly LayerNode[]): LayerNode[] {
  const out: LayerNode[] = [];
  for (let i = layers.length - 1; i >= 0; i--) out.push(displayNode(layers[i]!));
  return out;
}

function displayNode(node: LayerNode): LayerNode {
  if (!node.children?.length) return node;
  let cached = displayed.get(node);
  if (!cached) {
    cached = { ...node, children: displayTree(node.children) };
    displayed.set(node, cached);
  }
  return cached;
}

export interface LayerFilter {
  query: string;
  /** Layer types to show; empty shows every type. */
  types: ReadonlySet<string>;
}

export const isFiltering = (filter: LayerFilter): boolean => filter.query.trim() !== "" || filter.types.size > 0;

/** True when a layer passes the type filter and its name, id, or type name contains the query. */
export function layerMatches(node: LayerNode, filter: LayerFilter, typeName: (type: string) => string = (type) => type): boolean {
  if (filter.types.size > 0 && !filter.types.has(node.type)) return false;
  const q = filter.query.trim().toLowerCase();
  if (!q) return true;
  return node.name.toLowerCase().includes(q) || node.id.toLowerCase().includes(q) || typeName(node.type).toLowerCase().includes(q);
}

/** Prune a tree to matching layers plus the ancestors that lead to them. */
export function filterLayerTree(nodes: readonly LayerNode[], filter: LayerFilter, typeName?: (type: string) => string): LayerNode[] {
  const out: LayerNode[] = [];
  for (const node of nodes) {
    const children = node.children?.length ? filterLayerTree(node.children, filter, typeName) : [];
    if (children.length > 0) out.push({ ...node, children });
    else if (layerMatches(node, filter, typeName)) out.push(node.children?.length ? { ...node, children: [] } : node);
  }
  return out;
}

/** Every layer id in a tree. */
export function treeIds(nodes: readonly LayerNode[], out: Set<Id> = new Set()): Set<Id> {
  for (const node of nodes) {
    out.add(node.id);
    if (node.children?.length) treeIds(node.children, out);
  }
  return out;
}

/** Ids of layers that currently have children. */
export function parentLayerIds(nodes: readonly LayerNode[], out: Id[] = []): Id[] {
  for (const node of nodes) {
    if (!node.children?.length) continue;
    out.push(node.id);
    parentLayerIds(node.children, out);
  }
  return out;
}

/**
 * Ops that perform a TreeView drop. `ids` and `target` are in display order (front first, with the
 * index counted among the target's children before removal). Only moved layers get ops: each one
 * lands directly behind the layer that ends up in front of it, so dragged layers keep their order.
 */
export function planLayerMove(component: Component, ids: readonly Id[], target: { parentId: Id | null; index: number }): Op[] {
  const moved = moveTreeNodes(displayTree(component.layers), ids, target, (node, children) => ({ ...node, children }));
  const siblings = target.parentId === null ? moved : (findTreeNode(moved, target.parentId)?.children ?? []);
  const final = siblings.map((node) => node.id).reverse();
  const before = (target.parentId === null ? component.layers : (findLayer(component.layers, target.parentId)?.layer.children ?? [])).map((l) => l.id);
  const dragged = new Set(ids);
  const current = [...before];
  const ops: Op[] = [];
  final.forEach((id, i) => {
    if (!dragged.has(id) && before.includes(id)) return;
    const at = current.indexOf(id);
    const behind = i === 0 ? null : final[i - 1]!;
    const inPlace = at >= 0 && (behind === null ? at === 0 : current[at - 1] === behind);
    if (inPlace) return;
    if (at >= 0) current.splice(at, 1);
    const index = behind === null ? 0 : current.indexOf(behind) + 1;
    current.splice(index, 0, id);
    ops.push({ op: "moveLayer", component: component.id, id, parent: target.parentId, index });
  });
  return ops;
}

export interface InsertPlan {
  op: Op;
  /** Batch ref of the new layer; read its id from `idMap`. */
  ref: string;
  name: string;
}

export const INSERT_REF = "inserted";

const TEXT_BOX: [number, number] = [60, 22];

const vec2 = (value: unknown): [number, number] | undefined =>
  Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number" ? [value[0], value[1]] : undefined;

/**
 * An addLayer op for a new layer of `type`: in front of `anchor` (in its parent) when given, else
 * in front of everything, and centered in its parent. `component` names the layer component for
 * a componentInstance.
 */
export function planInsertLayer(
  doc: SonobeDocument,
  componentId: Id,
  registry: Registry,
  type: string,
  options: { anchor?: Id; component?: Id } = {},
): InsertPlan | undefined {
  const component = doc.components[componentId];
  const spec = registry.layers.get(type);
  // Patch components are never drawn, so they hold no layers (core refuses them).
  if (!component || !spec || component.kind === "patchComponent") return undefined;
  const target = options.component !== undefined ? doc.components[options.component] : undefined;
  if (options.component !== undefined && !target) return undefined;
  const anchor = options.anchor !== undefined ? findLayer(component.layers, options.anchor) : undefined;
  const parent = anchor?.parent ?? null;
  const frame = (parent ? vec2(parent.props.size) : undefined) ?? component.size ?? deviceScreenSize(doc.project.device);
  const name = target?.name ?? spec.name;
  const props: Record<string, InputValue> = {};
  const has = (key: string) => spec.props.some((p) => p.key === key);
  if (has("position")) {
    const size = target?.size ? vec2(target.size)! : type === "text" ? TEXT_BOX : (vec2(spec.props.find((p) => p.key === "size")?.default) ?? [100, 100]);
    if (target?.size && has("size")) props.size = [size[0], size[1]];
    props.position = [Math.max(0, Math.round((frame[0] - size[0]) / 2)), Math.max(0, Math.round((frame[1] - size[1]) / 2))];
  }
  const layer: NewLayer = { ref: INSERT_REF, type, name, props };
  if (target) layer.component = target.id;
  const op: Op = anchor
    ? { op: "addLayer", component: componentId, parent: parent?.id ?? null, index: anchor.index + 1, layer }
    : { op: "addLayer", component: componentId, parent: null, layer };
  return { op, ref: INSERT_REF, name };
}

function refersToLayer(value: InputValue, layerId: Id): boolean {
  if (isLayerInput(value)) return value.layer === layerId;
  if (!isLinkInput(value)) return false;
  const source = parseAddress(value.link);
  return source?.kind === "layer" && source.id === layerId;
}

/**
 * Patches that watch a layer (a layer input, or a link that reads it) or drive one of its
 * properties, sorted top to bottom as they sit in the patch editor.
 */
export function relatedPatchIds(component: Component, layerId: Id): Id[] {
  const ids = new Set<Id>();
  for (const [id, node] of Object.entries(component.patches)) {
    if (Object.values(node.inputs).some((value) => refersToLayer(value, layerId))) ids.add(id);
  }
  const layer = findLayer(component.layers, layerId)?.layer;
  for (const value of Object.values(layer?.props ?? {})) {
    if (!isLinkInput(value)) continue;
    const source = parseAddress(value.link);
    if (source?.kind === "patch" && component.patches[source.id]) ids.add(source.id);
  }
  const ui = (id: Id) => component.patches[id]!.ui;
  return [...ids].sort((a, b) => ui(a).y - ui(b).y || ui(a).x - ui(b).x);
}
