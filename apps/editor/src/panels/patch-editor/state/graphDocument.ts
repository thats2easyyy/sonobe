/**
 * The document the patch graph is drawn from. Most edits never show in the graph: a layer moved on
 * the canvas, a color scrubbed in the Inspector. Reading the store through this selector, the patch
 * editor keeps the document it has until one arrives that `deriveGraph` reads differently or whose
 * badges differ (a literal can raise a diagnostic, and badges are part of the graph), so those edits
 * derive no graph and hand React Flow nothing new.
 */

import type { Diagnostic, Id, Registry, SonobeDocument } from "@sonobe/core";
import { deepEqual, sameGraphSource } from "@sonobe/core/graph";
import { diagnosticsFor } from "../../../state/registry.ts";

/** Whether `deriveGraph` draws a diagnostic: one of this component's, above info, that names an item. The knob table's and the document's own name none. */
const drawn = (d: Diagnostic, componentId: Id) => d.component === componentId && d.severity !== "info" && d.itemIds.length > 0;

/** The same badge and cable message. A value checked again gets a new diagnostic that often says what the last one did. */
const sameBadge = (a: Diagnostic, b: Diagnostic) =>
  a === b || (a.code === b.code && a.severity === b.severity && a.message === b.message && a.port === b.port && deepEqual(a.itemIds, b.itemIds) && deepEqual(a.suggestions, b.suggestions));

/** Whether two documents' diagnostics give the graph of `componentId` the same badges, in the same order. */
function sameBadges(a: readonly Diagnostic[], b: readonly Diagnostic[], componentId: Id): boolean {
  if (a === b) return true;
  let j = 0;
  for (const d of a) {
    if (!drawn(d, componentId)) continue;
    while (j < b.length && !drawn(b[j]!, componentId)) j++;
    if (j === b.length || !sameBadge(d, b[j++]!)) return false;
  }
  for (; j < b.length; j++) if (drawn(b[j]!, componentId)) return false;
  return true;
}

/** A store selector with memory: the last document it returned, for as long as the graph of `componentId` would be the same. One per patch editor. */
export function graphDocumentSelector(componentId: Id, registry: Registry): (state: { doc: SonobeDocument }) => SonobeDocument {
  let shown: SonobeDocument | null = null;
  return ({ doc }) => {
    if (shown !== null && sameGraph(shown, doc, componentId, registry)) return shown;
    shown = doc;
    return doc;
  };
}

/** Whether the graph drawn from `shown` is still the graph of `doc`: the same source for `deriveGraph`, and the same badges. */
export function sameGraph(shown: SonobeDocument, doc: SonobeDocument, componentId: Id, registry: Registry): boolean {
  return shown === doc || (sameGraphSource(shown, doc, componentId) && sameBadges(diagnosticsFor(shown, registry), diagnosticsFor(doc, registry), componentId));
}
