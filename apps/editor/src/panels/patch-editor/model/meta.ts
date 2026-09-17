/**
 * Patch editor metadata on a component (the updateComponent `meta` op): where the nodes the document
 * doesn't place itself sit, so layer targets and component interface nodes keep their spot across
 * sessions, undo, and collaborators.
 *
 *   "meta": { "patchEditor": { "nodes": { "$in": [-260, 40], "@photo": [980, 20] } } }
 */

import { findLayer, type Component, type Op } from "@sonobe/core";
import { INPUTS_NODE_ID, layerIdOfNode, OUTPUTS_NODE_ID, type SessionPositions } from "./types.ts";

export const PATCH_EDITOR_META_KEY = "patchEditor";

type XY = { x: number; y: number };

const EMPTY: SessionPositions = Object.freeze({});

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Saved positions of layer target ("@layerId") and interface ("$in", "$out") nodes. */
export function readNodePositions(component: Pick<Component, "meta"> | undefined): SessionPositions {
  const nodes = asRecord(asRecord(asRecord(component?.meta)?.[PATCH_EDITOR_META_KEY])?.nodes);
  if (!nodes) return EMPTY;
  const out: Record<string, XY> = {};
  for (const [id, value] of Object.entries(nodes)) {
    if (Array.isArray(value) && finite(value[0]) && finite(value[1])) out[id] = { x: value[0], y: value[1] };
    else {
      const r = asRecord(value);
      if (r && finite(r.x) && finite(r.y)) out[id] = { x: r.x, y: r.y };
    }
  }
  return out;
}

/** Whether a saved node position still has a node to belong to. */
function stillExists(component: Component, nodeId: string): boolean {
  const layerId = layerIdOfNode(nodeId);
  if (layerId !== undefined) return !!findLayer(component.layers, layerId);
  if (nodeId === INPUTS_NODE_ID) return Object.keys(component.interface.inputs).length > 0;
  if (nodeId === OUTPUTS_NODE_ID) return Object.keys(component.interface.outputs).length > 0;
  return false;
}

/**
 * An updateComponent op that saves positions for layer and interface nodes (patch and comment ids
 * are ignored), keeping other patch editor metadata and dropping entries for layers that are gone.
 * Undefined when nothing would change.
 */
export function nodePositionsMetaOp(component: Component, positions: ReadonlyMap<string, XY>): Op | undefined {
  const current = readNodePositions(component);
  const nodes: Record<string, [number, number]> = {};
  for (const [id, p] of Object.entries(current)) if (stillExists(component, id)) nodes[id] = [Math.round(p.x), Math.round(p.y)];
  let changed = Object.keys(nodes).length !== Object.keys(current).length;
  for (const [id, p] of positions) {
    if (!(layerIdOfNode(id) !== undefined || id === INPUTS_NODE_ID || id === OUTPUTS_NODE_ID) || !stillExists(component, id)) continue;
    const next: [number, number] = [Math.round(p.x), Math.round(p.y)];
    const prev = nodes[id];
    if (prev && prev[0] === next[0] && prev[1] === next[1]) continue;
    nodes[id] = next;
    changed = true;
  }
  if (!changed) return undefined;
  const sorted = Object.fromEntries(Object.entries(nodes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const editorMeta = asRecord(component.meta?.[PATCH_EDITOR_META_KEY]) ?? {};
  return { op: "updateComponent", id: component.id, meta: { [PATCH_EDITOR_META_KEY]: { ...editorMeta, nodes: sorted } } };
}
