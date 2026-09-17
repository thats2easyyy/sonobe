/**
 * Free space for new patches: the spot nearest where you asked (the pointer, or beside the port you
 * dragged from) that overlaps no patch or layer target and doesn't straddle a comment frame. A patch
 * lands inside a comment frame only when you asked for a spot inside that frame.
 */

import { getPatchSpec, resolveNodePorts, type Component, type Id, type PatchNode, type Registry, type SonobeDocument } from "@sonobe/core";
import { COMMENT_PADDING, estimateNodeSize, HEADER_HEIGHT, padRect, rectContains, rectsOverlap, type Rect } from "./geometry.ts";

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
  const anchor: [number, number] = [base.x + Math.min(24, size.width / 2), base.y + HEADER_HEIGHT / 2];
  const home = comments.filter((c) => anchor[0] >= c.x && anchor[0] <= c.x + c.width && anchor[1] >= c.y && anchor[1] <= c.y + c.height);
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

/** Size estimate for a patch that doesn't exist yet (ports resolved like the editor shows them). */
export function estimatePatchSize(doc: SonobeDocument, registry: Registry, node: PatchNode): { width: number; height: number } {
  const ports = resolveNodePorts(doc, node, registry);
  const spec = ports?.spec ?? getPatchSpec(registry, node.type);
  return estimateNodeSize({
    kind: "patch",
    title: node.name || spec?.name || node.type,
    collapsed: node.ui.collapsed === true,
    inputs: (ports?.inputs ?? []).filter((p) => !p.advanced),
    outputs: ports?.outputs ?? [],
  });
}

/** Obstacles from the document alone (estimated patch sizes, comment frames), for callers without a canvas. */
export function documentObstacles(doc: SonobeDocument, component: Component, registry: Registry): PlacementObstacles {
  return {
    nodes: Object.values(component.patches).map((node) => ({ x: node.ui.x, y: node.ui.y, ...estimatePatchSize(doc, registry, node) })),
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
  const size = estimatePatchSize(doc, registry, virtual);
  if (!component) return near ?? { x: 40, y: 40 };
  const obstacles = documentObstacles(doc, component, registry);
  let preferred = near;
  if (!preferred) {
    const all = [...obstacles.nodes, ...(obstacles.comments ?? [])];
    preferred = all.length ? { x: Math.min(...all.map((r) => r.x)), y: Math.max(...all.map((r) => r.y + r.height)) + 40 } : { x: 40, y: 40 };
  }
  return findFreePosition(size, preferred, obstacles, options);
}
