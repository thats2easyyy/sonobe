/**
 * Link-drag search: drop a cable on empty canvas and pick what to connect it to.
 *
 * - **Patches**: every registry patch port on the opposite side whose type fits, with the best
 *   variant per patch (Transition on color for a color cable). Exact types, patches the source
 *   "pairs well with", and everyday tiers rank first.
 * - **Layer properties** ("Photo › Scale"): drive a property straight from an output, or read a
 *   layer output or property into an input. Selected layers come first.
 * - **Outputs in this graph**: when you drag from an input, existing outputs that fit.
 */

import {
  canConnect,
  COMPONENT_PATCH_TYPE,
  getPatchSpec,
  isLinkInput,
  resolveLayerOutputs,
  resolveLayerProps,
  resolveNodePorts,
  walkLayers,
  type Id,
  type PatchNode,
  type PatchSpec,
  type Registry,
  type ResolvedPort,
  type SonobeDocument,
  type ValueType,
} from "@sonobe/core";
import { CATEGORY_LABELS } from "../../../theme/tokens.ts";
import { fuzzySearch, type FuzzyKey } from "../../../ui/lib/fuzzy.ts";
import type { PortSide } from "./types.ts";

export interface LinkSearchSource {
  /** The side you dragged from: "out" looks for inputs, "in" looks for outputs. */
  side: PortSide;
  type: ValueType;
  /** Type of the patch you dragged from (for "pairs well with"). */
  patchType?: string;
}

/** A port as link search shows it. */
export interface LinkPort {
  key: string;
  name: string;
  type: ValueType;
  description?: string;
  advanced?: boolean;
}

/** Add a new patch and connect the cable to one of its ports. */
export interface LinkSearchItem {
  kind: "patch";
  id: string;
  spec: PatchSpec;
  typeParam?: ValueType;
  /** The port on the new patch that the cable connects to. */
  port: ResolvedPort;
  exact: boolean;
  suggested: boolean;
  conversion?: string;
  /** Rank for an empty query (lower first). */
  rank: number;
}

/** Connect the cable to a layer property (driving it) or read a layer output or property. */
export interface LayerLinkItem {
  kind: "layer";
  id: string;
  layerId: Id;
  layerName: string;
  layerType: string;
  /** Ancestor layer names, outermost first. */
  parents: readonly string[];
  port: LinkPort;
  /** "@photo.scale" */
  address: string;
  /** "Photo › Scale" */
  label: string;
  exact: boolean;
  conversion?: string;
  /** The output already driving this property (driving side only). */
  driver?: string;
  /** The layer is selected (Layers panel, canvas, or inspector). */
  selected: boolean;
  rank: number;
}

/** Connect the cable to an output that's already in the graph. */
export interface OutputLinkItem {
  kind: "output";
  id: string;
  /** "zoom_spring.output", "$in.pressed" */
  address: string;
  nodeId: string;
  nodeTitle: string;
  port: LinkPort;
  /** "Zoom Spring › Progress" */
  label: string;
  exact: boolean;
  conversion?: string;
  rank: number;
}

export type LinkCandidate = LinkSearchItem | LayerLinkItem | OutputLinkItem;

const tierOf = (spec: PatchSpec) => spec.tier ?? 2;

function orderedVariants(variants: readonly ValueType[], type: ValueType): ValueType[] {
  return variants.includes(type) ? [type, ...variants.filter((v) => v !== type)] : [...variants];
}

/** Every compatible (patch, port) pair for a dragged port, ranked for an empty query. */
export function linkSearchItems(doc: SonobeDocument, registry: Registry, source: LinkSearchSource): LinkSearchItem[] {
  const fromSpec = source.patchType ? getPatchSpec(registry, source.patchType) : undefined;
  const pairs = new Set(fromSpec?.pairsWellWith ?? []);
  const items: LinkSearchItem[] = [];
  let order = 0;
  for (const spec of registry.patches.values()) {
    order++;
    if (spec.type === COMPONENT_PATCH_TYPE) continue;
    const variants: (ValueType | undefined)[] = spec.variants?.length ? orderedVariants(spec.variants, source.type) : [undefined];
    const seen = new Set<string>();
    for (const variant of variants) {
      const node: PatchNode = { type: spec.type, inputs: {}, ui: { x: 0, y: 0 } };
      if (variant) node.typeParam = variant;
      const ports = resolveNodePorts(doc, node, registry);
      if (!ports) continue;
      for (const port of source.side === "out" ? ports.inputs : ports.outputs) {
        if (seen.has(port.key) || (port.variadicIndex !== undefined && port.variadicIndex > 1)) continue;
        const check = source.side === "out" ? canConnect(source.type, port.type) : canConnect(port.type, source.type);
        if (!check.ok) continue;
        seen.add(port.key);
        const exact = port.type === source.type;
        const suggested = pairs.has(spec.type);
        const rank = (exact ? 0 : port.type === "any" ? 2 : 1) * 10 + (suggested ? 0 : 3) + tierOf(spec) + (port.advanced ? 4 : 0) + order / 10_000;
        const item: LinkSearchItem = { kind: "patch", id: `${spec.type}|${port.key}`, spec, port, exact, suggested, rank };
        if (variant) item.typeParam = variant;
        if (check.conversion) item.conversion = check.conversion;
        items.push(item);
      }
    }
  }
  return items.sort((a, b) => a.rank - b.rank);
}

/** Properties people drive most, first. */
const EVERYDAY_PROPS = ["scale", "opacity", "position", "rotation", "color", "size", "cornerRadius", "enabled", "text", "fill", "backgroundColor", "blur"];

const everyday = (key: string) => {
  const i = EVERYDAY_PROPS.indexOf(key);
  return i < 0 ? EVERYDAY_PROPS.length : i;
};

export interface LayerLinkOptions {
  /** Only this layer (a cable dropped on a layer). */
  layerId?: Id;
  /** Layers selected elsewhere; their properties rank first. */
  selected?: readonly Id[];
}

/** Layer properties a dragged output can drive ("out"), or layer outputs and properties an input can read ("in"). */
export function layerLinkItems(doc: SonobeDocument, componentId: Id, registry: Registry, source: LinkSearchSource, options: LayerLinkOptions = {}): LayerLinkItem[] {
  const component = doc.components[componentId];
  if (!component) return [];
  const selected = new Set(options.selected ?? []);
  const parentsOf = new Map<Id, readonly string[]>();
  const items: LayerLinkItem[] = [];
  let order = 0;
  walkLayers(component.layers, (layer, info) => {
    const parents = info.parent ? [...(parentsOf.get(info.parent.id) ?? []), info.parent.name] : [];
    parentsOf.set(layer.id, parents);
    order++;
    if (options.layerId !== undefined && layer.id !== options.layerId) return;
    const props = resolveLayerProps(doc, componentId, layer, registry);
    if (!props) return;
    let ports: LinkPort[];
    if (source.side === "out") ports = props.filter((p) => p.bindable !== false);
    else {
      const outputs = resolveLayerOutputs(doc, componentId, layer, registry);
      ports = [...outputs, ...props.filter((p) => !outputs.some((o) => o.key === p.key))];
    }
    ports.forEach((port, index) => {
      const check = source.side === "out" ? canConnect(source.type, port.type) : canConnect(port.type, source.type);
      if (!check.ok || port.type === "layer") return;
      const exact = port.type === source.type;
      const isSelected = selected.has(layer.id);
      const value = layer.props[port.key];
      const item: LayerLinkItem = {
        kind: "layer",
        id: `layer|${layer.id}|${port.key}`,
        layerId: layer.id,
        layerName: layer.name,
        layerType: layer.type,
        parents,
        port: { key: port.key, name: port.name, type: port.type, ...(port.description ? { description: port.description } : {}), ...(port.advanced ? { advanced: true } : {}) },
        address: `@${layer.id}.${port.key}`,
        label: `${layer.name} › ${port.name}`,
        exact,
        selected: isSelected,
        rank: (isSelected ? 0 : 1000) + (exact ? 0 : 30) + everyday(port.key) + (port.advanced ? 8 : 0) + index / 1000 + order / 100_000,
      };
      if (check.conversion) item.conversion = check.conversion;
      if (source.side === "out" && isLinkInput(value)) item.driver = value.link;
      items.push(item);
    });
  });
  return items.sort((a, b) => a.rank - b.rank);
}

/** Outputs already in the component that an input can read (patch outputs, published component inputs). */
export function outputLinkItems(doc: SonobeDocument, componentId: Id, registry: Registry, source: LinkSearchSource, options: { exclude?: string } = {}): OutputLinkItem[] {
  const component = doc.components[componentId];
  if (!component || source.side !== "in") return [];
  const items: OutputLinkItem[] = [];
  const add = (nodeId: string, nodeTitle: string, port: LinkPort, address: string, position: number) => {
    const check = canConnect(port.type, source.type);
    if (!check.ok) return;
    const exact = port.type === source.type;
    const item: OutputLinkItem = { kind: "output", id: `output|${address}`, address, nodeId, nodeTitle, port, label: `${nodeTitle} › ${port.name}`, exact, rank: (exact ? 0 : 30) + position };
    if (check.conversion) item.conversion = check.conversion;
    items.push(item);
  };
  const patches = Object.entries(component.patches).sort(([, a], [, b]) => a.ui.y - b.ui.y || a.ui.x - b.ui.x);
  patches.forEach(([id, node], i) => {
    if (id === options.exclude) return;
    const ports = resolveNodePorts(doc, node, registry);
    const title = node.name || ports?.spec.name || node.type;
    for (const port of ports?.outputs ?? []) add(id, title, { key: port.key, name: port.name, type: port.type }, `${id}.${port.key}`, i / 100);
  });
  for (const port of Object.values(component.interface.inputs)) add("$in", "Component Inputs", { key: port.key, name: port.name, type: port.type }, `$in.${port.key}`, 0.5);
  return items.sort((a, b) => a.rank - b.rank);
}

export interface LinkCandidatesRequest extends LinkSearchSource {
  /** Only this layer's properties (a cable dropped on a layer node or row). */
  layerId?: Id;
  /** Selected layers rank first. */
  selectedLayers?: readonly Id[];
  /** The node dragged from, left out of "in this graph". */
  exclude?: string;
  /** Choosing what drives a layer property: existing outputs first. */
  drive?: boolean;
}

/** Everything a dropped cable can connect to, ordered by group for an empty query. */
export function linkCandidates(doc: SonobeDocument, componentId: Id, registry: Registry, request: LinkCandidatesRequest): LinkCandidate[] {
  const source: LinkSearchSource = { side: request.side, type: request.type, ...(request.patchType ? { patchType: request.patchType } : {}) };
  const selected = request.selectedLayers ?? [];
  if (request.layerId !== undefined) return layerLinkItems(doc, componentId, registry, source, { layerId: request.layerId, selected });
  const patches = linkSearchItems(doc, registry, source);
  const layers = layerLinkItems(doc, componentId, registry, source, { selected });
  const picked = layers.filter((l) => l.selected);
  const others = layers.filter((l) => !l.selected);
  if (request.side === "out") return [...picked, ...patches, ...others];
  const outputs = outputLinkItems(doc, componentId, registry, source, request.exclude !== undefined ? { exclude: request.exclude } : {});
  return request.drive ? [...outputs, ...patches, ...picked, ...others] : [...patches, ...outputs, ...picked, ...others];
}

/** Section header for a candidate (empty query). */
export function linkCandidateGroup(item: LinkCandidate): string {
  if (item.kind === "patch") return "New patch";
  if (item.kind === "output") return "In this graph";
  return item.selected ? "Selected layer" : "Layers";
}

const WEIGHTS: [exact: boolean, tier: 1 | 2 | 3, weight: number][] = [
  [true, 1, 1],
  [true, 2, 0.9],
  [true, 3, 0.8],
  [false, 1, 0.86],
  [false, 2, 0.78],
  [false, 3, 0.7],
];

function weighted(name: string, get: (item: LinkSearchItem) => string | readonly string[] | undefined, base: number): FuzzyKey<LinkCandidate>[] {
  return WEIGHTS.map(([exact, tier, weight]) => ({ name, weight: base * weight, get: (item: LinkCandidate) => (item.kind === "patch" && item.exact === exact && tierOf(item.spec) === tier ? get(item) : null) }));
}

/** Search keys (weighted by exactness and tier, so SearchList ranks the same way). */
export const LINK_SEARCH_KEYS: readonly FuzzyKey<LinkCandidate>[] = [
  ...weighted("name", (i) => i.spec.name, 1),
  ...weighted("aliases", (i) => i.spec.aliases, 0.75),
  ...weighted("port", (i) => i.port.name, 0.6),
  { name: "type", get: (i) => (i.kind === "patch" ? i.spec.type : null), weight: 0.5 },
  { name: "category", get: (i) => (i.kind === "patch" ? CATEGORY_LABELS[i.spec.category] : null), weight: 0.35 },
  { name: "label", get: (i) => (i.kind === "patch" ? null : i.label), weight: 0.95 },
  { name: "prop", get: (i) => (i.kind === "patch" ? null : i.port.name), weight: 0.85 },
  { name: "layer", get: (i) => (i.kind === "layer" ? i.layerName : i.kind === "output" ? i.nodeTitle : null), weight: 0.8 },
];

/** Filter and rank link-search candidates for a query. */
export function searchLinkItems<T extends LinkCandidate>(items: readonly T[], query: string, limit?: number): T[] {
  if (!query.trim()) return limit === undefined ? [...items] : items.slice(0, limit);
  return fuzzySearch<LinkCandidate>(items, query, LINK_SEARCH_KEYS, limit === undefined ? {} : { limit }).map((r) => r.item as T);
}
