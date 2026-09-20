/**
 * Frame-by-frame tidying for recipes with `tidy: "frames"`: the same layout tidy_graph gives with no
 * arguments. Node boxes are estimated as the editor draws them (packages/mcp geometry), each comment
 * frame's nodes are laid out inside it with ELK, and frames are refit and pushed apart.
 */

import type { Id, Op, SonobeDocument } from "@sonobe/core";
import { deriveGraph, planTidy, portCenterY, tidyPlanOps, type TidyNode } from "@sonobe/core/graph";
import type { EngineRegistry } from "@sonobe/engine";
import { elkGroupLayout, estimateGraphGeometry } from "@sonobe/mcp";

/** updatePatch, updateComment and setNodePositions ops that tidy one component's graph inside its frames. */
export async function tidyFramesOps(doc: SonobeDocument, registry: EngineRegistry, componentId: Id): Promise<Op[]> {
  const component = doc.components[componentId];
  if (!component || component.kind === "layerComponent" || !Object.keys(component.patches).length) return [];
  const geometry = estimateGraphGeometry(doc, registry, componentId);
  const model = deriveGraph({ doc, componentId, registry });
  // The request tidy_graph builds (packages/mcp/src/tools/write.ts tidyRequest): every node's box and port rows.
  const nodes: TidyNode[] = [];
  for (const node of model.nodes) {
    const box = geometry.nodes.get(node.id);
    if (node.data.kind === "comment" || !box) continue;
    const shape = { collapsed: node.data.kind === "patch" && node.data.collapsed };
    const ports = [
      ...node.data.inputs.map((p, i) => ({ id: p.handleId, side: "in" as const, y: portCenterY(shape, i) })),
      ...node.data.outputs.map((p, i) => ({ id: p.handleId, side: "out" as const, y: portCenterY(shape, i) })),
    ];
    nodes.push({ id: node.id, ...box, ports });
  }
  const plan = await planTidy(
    {
      nodes,
      edges: model.edges.map((e) => ({ source: e.source, sourceHandle: e.sourceHandle, target: e.target, targetHandle: e.targetHandle })),
      frames: [...geometry.frames].map(([id, rect]) => ({ id, ...rect })),
    },
    await elkGroupLayout(),
  );
  return tidyPlanOps(component, plan);
}
