/** Display names for item ids in HUD rows. */

import { findLayer, type Id, type SonobeDocument } from "@sonobe/core";

/** A patch's or layer's name (or a comment's first words), falling back to the id. */
export function itemDisplayName(doc: SonobeDocument, componentId: Id | undefined, id: Id): string {
  const component = doc.components[componentId ?? doc.project.root];
  if (!component) return id;
  const patch = component.patches[id];
  if (patch) return patch.name || id;
  const layer = findLayer(component.layers, id)?.layer;
  if (layer) return layer.name || id;
  const comment = component.comments.find((c) => c.id === id);
  if (comment) return comment.text.trim().slice(0, 32) || id;
  return id;
}

/** "Card, Press, Spring +2" */
export function summarizeNames(names: readonly string[], max = 3): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max}`;
}
