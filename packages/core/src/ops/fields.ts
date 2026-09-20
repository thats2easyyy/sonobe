/**
 * The top-level fields each op kind takes. applyOps refuses anything else, so a misspelled or
 * guessed field ("input" for "inputs", "mode": "replace") fails with a did-you-mean instead of being
 * ignored.
 */

import { didYouMean, didYouMeanText } from "../suggest.ts";
import type { OpKind } from "../types.ts";
import { fail } from "./context.ts";

const OP_FIELDS: Record<OpKind, readonly string[]> = {
  addLayer: ["component", "parent", "index", "layer"],
  updateLayer: ["component", "id", "props", "name", "locked", "collapsed"],
  moveLayer: ["component", "id", "parent", "index"],
  removeLayer: ["component", "id"],
  addPatch: ["component", "patch"],
  updatePatch: ["component", "id", "name", "typeParam", "inputCount", "muted", "settings", "ui"],
  replacePatch: ["component", "id", "patch", "inputMap", "outputMap"],
  removePatch: ["component", "id"],
  setInput: ["component", "target", "value"],
  connect: ["component", "from", "to"],
  disconnect: ["component", "to"],
  rename: ["component", "id", "name"],
  addComment: ["component", "comment"],
  updateComment: ["component", "id", "text", "rect", "color"],
  removeComment: ["component", "id"],
  addComponent: ["component", "ref"],
  removeComponent: ["id"],
  createComponent: ["component", "name", "layerIds", "patchIds", "ref"],
  updateInterface: ["component", "inputs", "outputs", "replace"],
  updateComponent: ["component", "id", "name", "notes", "size", "meta"],
  // Every op may name a component (it's ignored where there's none to target).
  setScript: ["component", "file", "source"],
  addAsset: ["component", "asset"],
  removeAsset: ["component", "id"],
  setProject: ["component", "changes"],
};

/** Ops that wrap a new item in one field, and that item's fields. */
const WRAPPED: Partial<Record<OpKind, { field: string; keys: readonly string[]; example: string }>> = {
  addLayer: { field: "layer", keys: ["ref", "id", "type", "name", "props", "children"], example: '{ "op": "addLayer", "layer": { "type": "rectangle", "name": "Card" } }' },
  addPatch: { field: "patch", keys: ["ref", "id", "type", "name", "typeParam", "inputCount", "inputs", "settings", "ui"], example: '{ "op": "addPatch", "patch": { "type": "switch", "name": "Liked" } }' },
  replacePatch: { field: "patch", keys: ["type", "typeParam", "inputCount", "settings", "name"], example: '{ "op": "replacePatch", "id": "spring", "patch": { "type": "classicAnimation" } }' },
  addComment: { field: "comment", keys: ["ref", "id", "text", "rect", "color"], example: '{ "op": "addComment", "comment": { "text": "Press states", "rect": [0, 0, 400, 200] } }' },
  addComponent: { field: "component", keys: ["id", "name", "kind", "interface", "layers", "patches", "comments", "notes", "size", "meta"], example: '{ "op": "addComponent", "component": { "name": "Card", "kind": "layerComponent" } }' },
};

/** Guesses for a whole-interface update. */
const REPLACE_GUESSES = new Set(["mode", "set", "replaceAll", "merge", "overwrite", "exact", "full"]);

/** Fail with a teaching error when `op` has a field its kind doesn't take. */
export function checkOpFields(op: Record<string, unknown>, kind: OpKind): void {
  const fields = OP_FIELDS[kind];
  for (const key of Object.keys(op)) {
    if (key === "op" || fields.includes(key)) continue;
    const wrapped = WRAPPED[kind];
    let hint = `${kind} takes: ${fields.join(", ")}.`;
    if (wrapped?.keys.includes(key)) hint = `Put "${key}" inside "${wrapped.field}": ${wrapped.example}.`;
    else if (kind === "updateInterface" && REPLACE_GUESSES.has(key)) hint = 'To make the ports you send the whole interface, pass "replace": true. Without it, ports merge by key and null unpublishes one.';
    else if (kind === "removeComponent" && key === "component") hint = 'Name the component to remove with "id": { "op": "removeComponent", "id": "card" }.';
    fail("unknown_field", `${kind} has no field "${key}".${didYouMeanText(didYouMean(key, fields))}`, { hint });
  }
}
