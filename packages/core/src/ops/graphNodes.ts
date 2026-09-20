/**
 * setNodePositions: where layer target ("@layerId") and component interface ("$in", "$out") nodes
 * sit in the patch graph. Stored in meta.patchEditor.nodes, merged entry by entry, so other nodes and
 * other patch editor metadata stay.
 */

import { INPUTS_NODE_ID, layerIdOfNode, nodePositionsIn, OUTPUTS_NODE_ID, PATCH_EDITOR_META_KEY, patchEditorMeta } from "../graph/graphNodes.ts";
import { allLayerIds, findLayer } from "../registry.ts";
import { didYouMean, didYouMeanText } from "../suggest.ts";
import type { Component, Id } from "../types.ts";
import { commitComponent, fail, getTargetComponent, resolveId, type OpContext, type OpOf, type OpOutcome } from "./context.ts";

type Position = [number, number];

const EXAMPLE = '{ "op": "setNodePositions", "positions": { "@card": [600, 40], "$in": null } }';

/** "@card", "@$card" (a layer this batch creates), "$in" or "$out", checked against the component. */
function nodeKey(ctx: OpContext, component: Component, key: string, clearing: boolean): string {
  if (key === INPUTS_NODE_ID || key === OUTPUTS_NODE_ID) return key;
  const layerId = layerIdOfNode(key);
  if (layerId !== undefined) {
    const id = layerId.startsWith("$") ? resolveId(ctx, layerId) : layerId;
    if (!clearing && !ctx.lenient && !findLayer(component.layers, id)) {
      const layers = allLayerIds(component.layers);
      fail("not_found", `There's no layer "${id}" in ${component.id}.${didYouMeanText(didYouMean(id, layers).map((l) => `@${l}`))}`, {
        hint: layers.length ? `Layer nodes are "@" plus a layer id: ${layers.slice(0, 8).map((l) => `@${l}`).join(", ")}.` : "This component has no layers.",
      });
    }
    return `@${id}`;
  }
  if (Object.hasOwn(component.patches, key)) {
    fail("invalid_op", `"${key}" is a patch; patches keep their position on the patch.`, { hint: `Move it with { "op": "updatePatch", "id": "${key}", "ui": { "x": 600, "y": 40 } }.` });
  }
  if (component.comments.some((c) => c.id === key)) {
    fail("invalid_op", `"${key}" is a comment; comments keep their position in their rect.`, { hint: `Move it with { "op": "updateComment", "id": "${key}", "rect": [x, y, width, height] }.` });
  }
  if (findLayer(component.layers, key)) fail("invalid_op", `Layer nodes are named "@${key}", not "${key}".`, { hint: EXAMPLE });
  return fail("invalid_op", `"${key}" isn't a graph node setNodePositions can place.`, { hint: `Use "@layerId" for a layer's node, "$in" or "$out" for the component's inputs and outputs: ${EXAMPLE}.` });
}

function position(key: string, value: unknown): Position | null {
  if (value === null) return null;
  if (Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number" && Number.isFinite(n))) return [Math.round(value[0] as number), Math.round(value[1] as number)];
  return fail("invalid_value", `positions["${key}"] must be [x, y] in patch editor points, or null to place the node automatically.`, { hint: EXAMPLE });
}

/** The component with its patch editor node map replaced (empty maps and objects removed). */
export function withNodeMap(component: Component, nodes: Record<string, unknown>): Component {
  const editorMeta: Record<string, unknown> = { ...(patchEditorMeta(component) ?? {}) };
  const sorted = Object.fromEntries(Object.entries(nodes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  if (Object.keys(sorted).length) editorMeta.nodes = sorted;
  else delete editorMeta.nodes;
  const meta: Record<string, unknown> = { ...(component.meta ?? {}) };
  if (Object.keys(editorMeta).length) meta[PATCH_EDITOR_META_KEY] = editorMeta;
  else delete meta[PATCH_EDITOR_META_KEY];
  const next: Component = { ...component, meta };
  if (!Object.keys(meta).length) delete next.meta;
  return next;
}

const rawNodes = (component: Component): Record<string, unknown> => {
  const nodes = patchEditorMeta(component)?.nodes;
  return nodes && typeof nodes === "object" && !Array.isArray(nodes) ? { ...(nodes as Record<string, unknown>) } : {};
};

export function setNodePositions(ctx: OpContext, op: OpOf<"setNodePositions">): OpOutcome {
  const component = getTargetComponent(ctx, op.component);
  const positions: unknown = op.positions;
  if (!positions || typeof positions !== "object" || Array.isArray(positions)) fail("invalid_op", 'setNodePositions needs "positions": node id → [x, y] or null.', { hint: EXAMPLE });
  const nodes = rawNodes(component);
  const saved = nodePositionsIn(patchEditorMeta(component));
  const applied: Record<string, Position | null> = {};
  const inverse: Record<string, Position | null> = {};
  for (const [key, value] of Object.entries(positions as Record<string, unknown>)) {
    if (value === undefined) continue;
    const next = position(key, value);
    const id = nodeKey(ctx, component, key, next === null);
    if (Object.hasOwn(inverse, id)) continue;
    const before = saved[id];
    inverse[id] = before ? [before.x, before.y] : null;
    applied[id] = next;
    if (next === null) delete nodes[id];
    else nodes[id] = next;
  }
  commitComponent(ctx, withNodeMap(component, nodes));
  return {
    ids: Object.keys(applied),
    applied: { op: "setNodePositions", component: component.id, positions: applied },
    inverse: [{ op: "setNodePositions", component: component.id, positions: inverse }],
  };
}

/**
 * Drop the saved positions of these layers' nodes (removeLayer, createComponent), returning the
 * component without them and a setNodePositions body that puts them back.
 */
export function dropLayerNodePositions(component: Component, layerIds: Iterable<Id>): { component: Component; restore: Record<string, Position> | undefined } {
  const saved = nodePositionsIn(patchEditorMeta(component));
  const nodes = rawNodes(component);
  const restore: Record<string, Position> = {};
  let changed = false;
  for (const id of layerIds) {
    const key = `@${id}`;
    if (!Object.hasOwn(nodes, key)) continue;
    const p = saved[key];
    if (p) restore[key] = [p.x, p.y];
    delete nodes[key];
    changed = true;
  }
  if (!changed) return { component, restore: undefined };
  return { component: withNodeMap(component, nodes), restore: Object.keys(restore).length ? restore : undefined };
}
