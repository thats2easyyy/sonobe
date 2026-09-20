/**
 * Node boxes of a component's patch graph for tools that place, tidy, list or draw nodes: the shared
 * node size model from @sonobe/core/graph (SF Pro / SF Mono metrics), with the live values a
 * deterministic runtime prints after one second, since live values widen nodes the way they do in
 * the editor. When the app's patch editor shows the component at the same revision, the sizes it
 * measured (and where it placed layer and interface nodes) replace the estimates.
 */

import {
  componentDocument,
  getDiagnostics,
  type Diagnostic,
  type Id,
  type SonobeDocument,
} from "@sonobe/core";
import {
  componentNodeBoxes,
  createElkGroupLayout,
  flowNodeKind,
  rectsOverlap,
  type ElkLike,
  type GroupLayout,
  type Rect,
} from "@sonobe/core/graph";
import { createRuntime, type EngineRegistry } from "@sonobe/engine";
import type { DocumentSnapshot, MeasuredGraph, SonobeHost } from "./host.ts";

export interface GraphGeometry {
  component: Id;
  /** Graph node id (patch id, "@layerId", "$in", "$out") → its box in patch editor points. */
  nodes: Map<string, Rect>;
  /** Comment id → its frame. */
  frames: Map<string, Rect>;
  /** Nodes whose size the open patch editor measured; every other size is estimated from the document. */
  measured: ReadonlySet<string>;
  /** The diagnostics the estimate sized issue badges for, so a drawing shows the same badges. */
  diagnostics: readonly Diagnostic[];
}

const LIVE_FRAMES = 60;

/**
 * Runs `fn` with the live values of the component after a second on its own (its root is the
 * component), or with none when it can't run headless.
 */
export function withLiveValues<T>(
  doc: SonobeDocument,
  registry: EngineRegistry,
  componentId: Id,
  fn: (live?: (address: string) => unknown) => T,
): T {
  let runtime: ReturnType<typeof createRuntime> | undefined;
  try {
    runtime = createRuntime(componentDocument(doc, componentId), {
      registry,
      deterministic: true,
      fps: 60,
      platform: {},
    });
    for (let i = 0; i < LIVE_FRAMES; i++) runtime.step();
  } catch {
    runtime?.dispose();
    return fn();
  }
  const rt = runtime;
  try {
    return fn((address) => rt.getRawValue(address));
  } finally {
    rt.dispose();
  }
}

/** Every node's estimated box (issue badges and live values included) and every comment frame of a component's graph. */
export function estimateGraphGeometry(
  doc: SonobeDocument,
  registry: EngineRegistry,
  componentId: Id,
  diagnostics: readonly Diagnostic[] = getDiagnostics(doc, registry),
): GraphGeometry {
  const component = doc.components[componentId];
  return {
    component: componentId,
    nodes: withLiveValues(doc, registry, componentId, (live) =>
      componentNodeBoxes(doc, registry, componentId, { diagnostics, ...(live ? { live } : {}) }),
    ),
    frames: new Map(
      (component?.comments ?? []).map((c) => [
        c.id,
        { x: c.rect[0], y: c.rect[1], width: c.rect[2], height: c.rect[3] },
      ]),
    ),
    measured: new Set(),
    diagnostics,
  };
}

/**
 * Estimates by document and component. Hosts hand out one document object per revision, so this
 * forgets old revisions on its own; running the prototype for live values is the costly part.
 */
const estimates = new WeakMap<SonobeDocument, Map<Id, GraphGeometry>>();

/** estimateGraphGeometry, computed once per document object and component. */
export function cachedGraphEstimate(doc: SonobeDocument, registry: EngineRegistry, componentId: Id): GraphGeometry {
  let byComponent = estimates.get(doc);
  if (!byComponent) estimates.set(doc, (byComponent = new Map()));
  let geometry = byComponent.get(componentId);
  if (!geometry) byComponent.set(componentId, (geometry = estimateGraphGeometry(doc, registry, componentId)));
  return geometry;
}

/** Lay the editor's boxes over the estimate: the sizes it measured, and where it put layer and interface nodes. */
export function overlayMeasured(estimate: GraphGeometry, drawn: MeasuredGraph): GraphGeometry {
  const nodes = new Map(estimate.nodes);
  const measured = new Set<string>();
  for (const [id, box] of Object.entries(drawn.nodes)) {
    const base = nodes.get(id);
    if (!base) continue;
    // Patches sit at their ui position; the editor places layer and interface nodes from what it measured.
    const placed = flowNodeKind(id) !== "patch";
    nodes.set(id, {
      x: placed ? Math.round(box.x) : base.x,
      y: placed ? Math.round(box.y) : base.y,
      width: box.measured ? Math.ceil(box.width) : base.width,
      height: box.measured ? Math.ceil(box.height) : base.height,
    });
    if (box.measured) measured.add(id);
  }
  return { ...estimate, nodes, measured };
}

/**
 * A component's graph geometry at the snapshot's revision: estimated from the document (cached),
 * refined by the open editor's measurements when the host has them for this component and revision.
 */
export async function resolveGraphGeometry(
  host: SonobeHost,
  snap: DocumentSnapshot,
  componentId: Id,
): Promise<GraphGeometry> {
  const estimate = cachedGraphEstimate(snap.doc, host.registry, componentId);
  if (!host.graphGeometry) return estimate;
  let drawn: MeasuredGraph | null = null;
  try {
    drawn = await host.graphGeometry({ docId: snap.docId, component: componentId });
  } catch {
    // Measurements only refine the estimate, which stands on its own.
  }
  if (!drawn || drawn.component !== componentId || drawn.revision !== snap.revision) return estimate;
  return overlayMeasured(estimate, drawn);
}

/** How the boxes were sized, as a line for tool results. */
export function sizesNote(geometry: GraphGeometry): string {
  const total = geometry.nodes.size;
  const measured = geometry.measured.size;
  if (total && measured >= total) return "Node sizes are as the patch editor measured them.";
  if (measured)
    return `Node sizes: ${measured} of ${total} as the patch editor measured them, the rest (off screen there) estimated.`;
  return "Node sizes are estimated as the editor draws them (with live values after a second).";
}

/** A node with its box, as results list it: "names (460,520 286×124)". */
export function boxLabel(id: string, box: Rect): string {
  return `${id} (${box.x},${box.y} ${box.width}×${box.height})`;
}

/** Nodes whose boxes overlap, as pairs, in the order given. */
export function overlappingPairs(boxes: Iterable<readonly [string, Rect]>): [string, string][] {
  const list = [...boxes];
  const out: [string, string][] = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      if (rectsOverlap(list[i]![1], list[j]![1])) out.push([list[i]![0], list[j]![0]]);
  return out;
}

/** The other nodes of the graph whose boxes overlap node `id`'s box. */
export function overlapsOf(geometry: GraphGeometry, id: string): string[] {
  const box = geometry.nodes.get(id);
  if (!box) return [];
  return [...geometry.nodes].filter(([other, r]) => other !== id && rectsOverlap(box, r)).map(([other]) => other);
}

let elk: Promise<ElkLike> | undefined;

/** ELK's layered layout for tidy_graph, loaded on first use (the same engine the editor's Tidy Up uses). */
export function elkGroupLayout(): Promise<GroupLayout> {
  elk ??= import("elkjs/lib/elk.bundled.js").then((m) => new m.default());
  elk.catch(() => {
    elk = undefined;
  });
  return elk.then(createElkGroupLayout);
}
