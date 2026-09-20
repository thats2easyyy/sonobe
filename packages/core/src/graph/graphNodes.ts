/**
 * Graph nodes the document doesn't place on an item: layer targets ("@layerId") and the component
 * interface nodes ("$in", "$out"). Their positions live in the component's patch editor metadata and
 * change only through the setNodePositions op, so they're undoable, saved, and shared:
 *
 *   "meta": { "patchEditor": { "nodes": { "$in": [-260, 40], "@photo": [980, 20] } } }
 *
 * A node without a saved position is placed automatically next to the patches it connects to.
 */

import { parseAddress } from "../address.ts";
import { findLayer } from "../registry.ts";
import { listInputs } from "../ops/references.ts";
import type { Component, Id, Op } from "../types.ts";
import { isLinkInput } from "../values.ts";

export const PATCH_EDITOR_META_KEY = "patchEditor";
export const INPUTS_NODE_ID = "$in";
export const OUTPUTS_NODE_ID = "$out";

export const layerNodeId = (layerId: Id): string => `@${layerId}`;
export const layerIdOfNode = (nodeId: string): Id | undefined => (nodeId.startsWith("@") ? nodeId.slice(1) : undefined);

/** True for the ids setNodePositions takes: "@layerId", "$in", "$out". */
export const isPositionedNodeId = (nodeId: string): boolean => layerIdOfNode(nodeId) !== undefined || nodeId === INPUTS_NODE_ID || nodeId === OUTPUTS_NODE_ID;

type XY = { x: number; y: number };

const EMPTY: Readonly<Record<string, XY>> = Object.freeze({});

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** The patch editor metadata object of a component, when it has one. */
export function patchEditorMeta(component: Pick<Component, "meta"> | undefined): Record<string, unknown> | undefined {
  return asRecord(asRecord(component?.meta)?.[PATCH_EDITOR_META_KEY]);
}

/** Saved positions of layer target ("@layerId") and interface ("$in", "$out") nodes. */
export function readNodePositions(component: Pick<Component, "meta"> | undefined): Readonly<Record<string, XY>> {
  return nodePositionsIn(patchEditorMeta(component));
}

/** Positions in a patch editor metadata object ([x, y] pairs, or { x, y } from older files). */
export function nodePositionsIn(editorMeta: Record<string, unknown> | undefined): Readonly<Record<string, XY>> {
  const nodes = asRecord(editorMeta?.nodes);
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

const stripIndex = (address: string) => address.replace(/#\d+$/, "");

/**
 * Layers that get a node in the component's graph: one of their properties is driven by a cable, or
 * a cable reads one of their properties or outputs. The patch editor shows exactly these (plus
 * properties someone just asked to drive).
 */
export function layersWithGraphNodes(component: Component): Set<Id> {
  const ids = new Set<Id>();
  for (const entry of listInputs(component)) {
    if (!isLinkInput(entry.value)) continue;
    if (entry.target.kind === "layer") ids.add(entry.target.id);
    const src = parseAddress(stripIndex(entry.value.link));
    if (src?.kind === "layer") ids.add(src.id);
  }
  for (const id of ids) if (!findLayer(component.layers, id)) ids.delete(id);
  return ids;
}

/** Whether a node id still has something to belong to: the layer exists, or the interface side has ports. */
export function positionedNodeExists(component: Component, nodeId: string): boolean {
  const layerId = layerIdOfNode(nodeId);
  if (layerId !== undefined) return !!findLayer(component.layers, layerId);
  if (nodeId === INPUTS_NODE_ID) return Object.keys(component.interface.inputs).length > 0;
  if (nodeId === OUTPUTS_NODE_ID) return Object.keys(component.interface.outputs).length > 0;
  return false;
}

/**
 * A setNodePositions op that saves `positions` for layer and interface nodes (patch and comment ids
 * are ignored) and clears saved entries whose layer is gone. Only changed entries are named.
 * Undefined when nothing would change.
 */
export function nodePositionsOp(component: Component, positions: ReadonlyMap<string, XY>): Op | undefined {
  const current = readNodePositions(component);
  const changes: Record<string, [number, number] | null> = {};
  for (const id of Object.keys(current)) if (!positionedNodeExists(component, id)) changes[id] = null;
  for (const [id, p] of positions) {
    if (!isPositionedNodeId(id) || !positionedNodeExists(component, id)) continue;
    const next: [number, number] = [Math.round(p.x), Math.round(p.y)];
    const prev = current[id];
    if (prev && Math.round(prev.x) === next[0] && Math.round(prev.y) === next[1]) continue;
    changes[id] = next;
  }
  if (Object.keys(changes).length === 0) return undefined;
  return { op: "setNodePositions", component: component.id, positions: changes };
}
