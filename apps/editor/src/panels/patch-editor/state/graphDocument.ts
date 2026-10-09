/**
 * The document the patch graph is drawn from. Most edits never show in the graph: a layer moved on
 * the canvas, a color scrubbed in the Inspector. Reading the store through this selector, the patch
 * editor keeps the document it has until one arrives that `deriveGraph` reads differently or that
 * has other diagnostics (a literal can raise one, and badges are part of the graph), so those edits
 * don't render it at all.
 */

import type { Diagnostic, Id, Registry, SonobeDocument } from "@sonobe/core";
import { sameGraphSource } from "@sonobe/core/graph";
import { diagnosticsFor } from "../../../state/registry.ts";

const sameItems = (a: readonly Diagnostic[], b: readonly Diagnostic[]) => a === b || (a.length === b.length && a.every((d, i) => d === b[i]));

/** A store selector with memory: the last document it returned, for as long as the graph of `componentId` would be the same. One per patch editor. */
export function graphDocumentSelector(componentId: Id, registry: Registry): (state: { doc: SonobeDocument }) => SonobeDocument {
  let shown: SonobeDocument | null = null;
  return ({ doc }) => {
    if (shown !== null && sameGraph(shown, doc, componentId, registry)) return shown;
    shown = doc;
    return doc;
  };
}

/** Whether the graph drawn from `shown` is still the graph of `doc`: the same source for `deriveGraph`, and the same diagnostics. */
export function sameGraph(shown: SonobeDocument, doc: SonobeDocument, componentId: Id, registry: Registry): boolean {
  return shown === doc || (sameGraphSource(shown, doc, componentId) && sameItems(diagnosticsFor(shown, registry), diagnosticsFor(doc, registry)));
}
