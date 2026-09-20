/**
 * Node boxes of a component's patch graph for tools that place or tidy nodes: the shared node size
 * model from @sonobe/core/graph (SF Pro / SF Mono metrics), with the live values a deterministic
 * runtime prints after one second, since live values widen nodes the way they do in the editor.
 * These are estimates; measured sizes from an open editor can refine them later.
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
  type ElkLike,
  type GroupLayout,
  type Rect,
} from "@sonobe/core/graph";
import { createRuntime, type EngineRegistry } from "@sonobe/engine";

export interface GraphGeometry {
  component: Id;
  /** Graph node id (patch id, "@layerId", "$in", "$out") → its box in patch editor points. */
  nodes: Map<string, Rect>;
  /** Comment id → its frame. */
  frames: Map<string, Rect>;
  /** False: sizes are estimated from the document, not measured in the editor. */
  measured: boolean;
}

const LIVE_FRAMES = 60;

/**
 * Runs `fn` with the live values of the component after a second on its own (its root is the
 * component), or with none when it can't run headless.
 */
function withLiveValues<T>(
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
    measured: false,
  };
}

let elk: Promise<ElkLike> | undefined;

/** ELK's layered layout for tidy_graph, loaded on first use (the same engine the editor's Tidy Up uses). */
export function elkGroupLayout(): Promise<GroupLayout> {
  elk ??= import("elkjs/lib/elk.bundled.js").then(
    (m) => new (m.default as unknown as new () => ElkLike)(),
  );
  elk.catch(() => {
    elk = undefined;
  });
  return elk.then(createElkGroupLayout);
}
