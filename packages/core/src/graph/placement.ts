/**
 * Free space for new patches: the spot nearest where you asked (the pointer, or beside the port you
 * dragged from) that overlaps no patch or layer target and doesn't straddle a comment frame. A patch
 * lands inside a comment frame only when you asked for a spot inside that frame.
 */

import { FORMAT_VERSION } from "../document.ts";
import { getOwn } from "../ids.ts";
import { allLayers } from "../registry.ts";
import type { Component, Diagnostic, Id, PatchNode, Registry, SonobeDocument } from "../types.ts";
import { deriveGraph } from "./deriveGraph.ts";
import { framesAt } from "./frames.ts";
import { COMMENT_PADDING, padRect, rectContains, rectsOverlap, type Rect } from "./geometry.ts";
import { estimateNodeSize, type NodeSize, type NodeTextMeasurer } from "./nodeSize.ts";

type XY = { x: number; y: number };

export interface PlacementObstacles {
  /** Patches, layer targets, and interface nodes. */
  nodes: readonly Rect[];
  /** Comment frames. */
  comments?: readonly Rect[];
}

export type PlacementBias = "right" | "left" | "any";

export interface PlacementOptions {
  /** Which way to look first: "right" (after an output), "left" (before an input), or "any". Default "any". */
  bias?: PlacementBias;
  /** Room kept between the new patch and other nodes. Default 20. */
  gap?: number;
  /** Search grid step. Default 16. */
  step?: number;
  /** How far to look before giving up and using the preferred spot. Default 1200. */
  radius?: number;
}

const offsetCache = new Map<string, readonly [number, number][]>();

/** Offsets around the preferred spot, cheapest first: vertical shifts keep columns, the biased side costs more. */
function offsets(step: number, radius: number, bias: PlacementBias): readonly [number, number][] {
  const key = `${step}|${radius}|${bias}`;
  const cached = offsetCache.get(key);
  if (cached) return cached;
  const n = Math.floor(radius / step);
  const list: { dx: number; dy: number; cost: number }[] = [];
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const dx = i * step;
      const dy = j * step;
      const wrongSide = (bias === "right" && dx < 0) || (bias === "left" && dx > 0);
      list.push({ dx, dy, cost: Math.hypot(dx * (wrongSide ? 3 : 1.25), dy) });
    }
  }
  list.sort((a, b) => a.cost - b.cost || Math.abs(a.dy) - Math.abs(b.dy) || a.dy - b.dy || a.dx - b.dx);
  const out = list.map(({ dx, dy }) => [dx, dy] as [number, number]);
  offsetCache.set(key, out);
  return out;
}

/** The top-left position for a `size` box near `preferred` that doesn't collide with anything. */
export function findFreePosition(size: { width: number; height: number }, preferred: XY, obstacles: PlacementObstacles, options: PlacementOptions = {}): XY {
  const gap = options.gap ?? 20;
  const step = options.step ?? 16;
  const radius = options.radius ?? 1200;
  const base = { x: Math.round(preferred.x), y: Math.round(preferred.y) };
  const nodes = obstacles.nodes.map((r) => padRect(r, gap));
  const comments = obstacles.comments ?? [];
  // The frame you asked to put the patch in: the one under its title bar's leading edge.
  const home = framesAt({ ...base, ...size }, comments);
  const interior = (c: Rect): Rect => ({ x: c.x + 8, y: c.y + COMMENT_PADDING.top, width: c.width - 16, height: c.height - COMMENT_PADDING.top - 8 });
  const fits = (rect: Rect) => {
    for (const n of nodes) if (rectsOverlap(n, rect)) return false;
    for (const c of comments) {
      if (home.includes(c) && rectContains(interior(c), rect)) continue;
      if (rectsOverlap(padRect(c, gap / 2), rect)) return false;
    }
    return true;
  };
  for (const [dx, dy] of offsets(step, radius, options.bias ?? "any")) {
    const rect = { x: base.x + dx, y: base.y + dy, width: size.width, height: size.height };
    if (fits(rect)) return { x: rect.x, y: rect.y };
  }
  return base;
}

const ESTIMATE_ID = "estimate";

/**
 * Size estimate for one patch, alone (a patch that doesn't exist yet, or one being pasted), drawn
 * as the editor would draw it in `component` (default: the root).
 */
export function estimatePatchSize(doc: SonobeDocument, registry: Registry, node: PatchNode, options: { component?: Id; measure?: NodeTextMeasurer } = {}): NodeSize {
  const host = getOwn(doc.components, options.component ?? doc.project.root);
  const scratch: Component = host
    ? { ...host, id: `${host.id}__${ESTIMATE_ID}`, patches: { [ESTIMATE_ID]: node }, comments: [], interface: { inputs: {}, outputs: {} } }
    : { formatVersion: FORMAT_VERSION, id: ESTIMATE_ID, name: "Estimate", kind: "patchComponent", interface: { inputs: {}, outputs: {} }, layers: [], patches: { [ESTIMATE_ID]: node }, comments: [] };
  const model = deriveGraph({ doc: { ...doc, components: { ...doc.components, [scratch.id]: scratch } }, componentId: scratch.id, registry, ...(options.measure ? { measure: options.measure } : {}) });
  const data = model.nodes.find((n) => n.id === ESTIMATE_ID)?.data;
  return data ? estimateNodeSize(data, { ...(options.measure ? { measure: options.measure } : {}), layerName: (id) => host && findLayerName(host, id) }) : { width: 164, height: 50 };
}

const layerNames = new WeakMap<Component, Map<Id, string>>();

function findLayerName(component: Component, id: Id): string | undefined {
  let names = layerNames.get(component);
  if (!names) layerNames.set(component, (names = new Map(allLayers(component.layers).map((l) => [l.id, l.name]))));
  return names.get(id);
}

export interface NodeBoxOptions {
  /** Measures node text (default: the SF Pro metrics table). */
  measure?: NodeTextMeasurer;
  /** Live values by address, printed on output rows (a headless runtime stepped a second). */
  live?: (address: string) => unknown;
  /** Document diagnostics, for issue badges. */
  diagnostics?: readonly Diagnostic[];
}

/**
 * Every node of a component's graph (patches, "@layer" targets, "$in"/"$out") with its position and
 * estimated size, as the patch editor would draw it. Comments aren't included; their rect is their box.
 */
export function componentNodeBoxes(doc: SonobeDocument, registry: Registry, componentId: Id, options: NodeBoxOptions = {}): Map<string, Rect> {
  const component = getOwn(doc.components, componentId);
  if (!component) return new Map();
  const base = { doc, componentId, registry, ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}), ...(options.measure ? { measure: options.measure } : {}) };
  const estimate = { ...(options.measure ? { measure: options.measure } : {}), ...(options.live ? { live: options.live } : {}), layerName: (id: Id) => findLayerName(component, id) };
  let model = deriveGraph(base);
  const sizes = new Map<string, NodeSize>();
  for (const node of model.nodes) if (node.type !== "comment") sizes.set(node.id, estimateNodeSize(node.data, estimate));
  // Live values widen nodes; place layer and interface nodes from those sizes.
  if (options.live) model = deriveGraph({ ...base, sizes });
  const boxes = new Map<string, Rect>();
  for (const node of model.nodes) {
    const size = sizes.get(node.id);
    if (size) boxes.set(node.id, { x: node.position.x, y: node.position.y, ...size });
  }
  return boxes;
}

/** Obstacles from the document alone (estimated node sizes, comment frames), for callers without a canvas. */
export function documentObstacles(doc: SonobeDocument, component: Component, registry: Registry, options: NodeBoxOptions = {}): PlacementObstacles {
  const withComponent = doc.components[component.id] === component ? doc : { ...doc, components: { ...doc.components, [component.id]: component } };
  return {
    nodes: [...componentNodeBoxes(withComponent, registry, component.id, options).values()],
    comments: component.comments.map((c) => ({ x: c.rect[0], y: c.rect[1], width: c.rect[2], height: c.rect[3] })),
  };
}

/**
 * Where to insert a patch of `type` in a component without overlapping anything: near `near` when
 * given, else just below the existing graph (left-aligned with it). For panels that insert patches
 * without a patch editor canvas (the Learn drawer, commands).
 */
export function freeInsertPosition(doc: SonobeDocument, componentId: Id, registry: Registry, type: string, near?: XY, options: PlacementOptions & { typeParam?: string; component?: Id } = {}): XY {
  const component = doc.components[componentId];
  const virtual: PatchNode = { type, inputs: {}, ui: { x: 0, y: 0 } };
  if (options.typeParam) virtual.typeParam = options.typeParam as PatchNode["typeParam"];
  if (options.component) virtual.component = options.component;
  const size = estimatePatchSize(doc, registry, virtual, { component: componentId });
  if (!component) return near ?? { x: 40, y: 40 };
  const obstacles = documentObstacles(doc, component, registry);
  let preferred = near;
  if (!preferred) {
    const all = [...obstacles.nodes, ...(obstacles.comments ?? [])];
    preferred = all.length ? { x: Math.min(...all.map((r) => r.x)), y: Math.max(...all.map((r) => r.y + r.height)) + 40 } : { x: 40, y: 40 };
  }
  return findFreePosition(size, preferred, obstacles, options);
}
