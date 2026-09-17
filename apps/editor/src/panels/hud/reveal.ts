/** Reveal items from the HUD: switch to their component, select what still exists, and ask panels to scroll to it. */

import type { Id } from "@sonobe/core";
import type { DocumentStore } from "../../state/document.ts";
import { currentComponentId, itemKindOf, type SelectionStore } from "../../state/selection.ts";

export interface RevealTarget {
  document: DocumentStore;
  selection: SelectionStore;
}

/**
 * Select `ids` in `component` (entering it when needed) and publish a reveal request. Returns false
 * when the component is gone or none of the ids exist anymore.
 */
export function revealItems(session: RevealTarget, component: Id | undefined, ids: readonly Id[]): boolean {
  const doc = session.document.getState().doc;
  const componentId = component ?? doc.project.root;
  const target = doc.components[componentId];
  if (!target) return false;

  const layers: Id[] = [];
  const patches: Id[] = [];
  const comments: Id[] = [];
  for (const id of new Set(ids)) {
    const kind = itemKindOf(target, id);
    if (kind === "layer") layers.push(id);
    else if (kind === "patch") patches.push(id);
    else if (kind === "comment") comments.push(id);
  }
  const existing = [...layers, ...patches, ...comments];

  const selection = session.selection.getState();
  if (currentComponentId(selection) !== componentId) {
    const index = selection.componentPath.indexOf(componentId);
    const path = index >= 0 ? selection.componentPath.slice(0, index + 1) : componentId === doc.project.root ? [componentId] : [doc.project.root, componentId];
    selection.setComponentPath(path);
  }
  if (existing.length === 0) return false;
  session.selection.getState().select({ layers, patches, comments });
  session.selection.getState().requestReveal(componentId, existing);
  return true;
}
