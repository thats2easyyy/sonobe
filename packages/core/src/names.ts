/**
 * Display names for patches and layers: what the editor shows on a node or a layer row. Messages
 * people read (diagnostics, runtime issues, undo labels) use these; ids stay in structured fields.
 */

import { VARIABLE_BROADCASTER_TYPE, VARIABLE_RECEIVER_TYPE } from "./graph.ts";
import type { LayerNode, PatchNode, PatchSpec } from "./types.ts";

type NamedPatch = Pick<PatchNode, "type"> & { name?: string; settings?: PatchNode["settings"] };

/** A Variable Broadcaster's or Receiver's variable name (trimmed), or "" for other patches and unnamed variables. */
export function variableName(node: NamedPatch): string {
  if (node.type !== VARIABLE_BROADCASTER_TYPE && node.type !== VARIABLE_RECEIVER_TYPE) return "";
  const name = node.settings?.name;
  return typeof name === "string" ? name.trim() : "";
}

/**
 * The name a patch shows: its custom name, a variable's name, its type's name, or its type id.
 * ("Photo Scale", "isLiked", "Math Expression").
 */
export function patchDisplayName(node: NamedPatch, spec?: Pick<PatchSpec, "name">): string {
  return node.name || variableName(node) || spec?.name || node.type;
}

/** A patch in a sentence: `"Photo Scale" (Transition)`, or `"Math Expression"` when the name is the type's. */
export function describePatch(node: NamedPatch, spec?: Pick<PatchSpec, "name">): string {
  const title = patchDisplayName(node, spec);
  return spec && title !== spec.name ? `"${title}" (${spec.name})` : `"${title}"`;
}

/** The name a layer shows (its id when it has none). */
export function layerDisplayName(layer: Pick<LayerNode, "id" | "name">): string {
  return layer.name || layer.id;
}
