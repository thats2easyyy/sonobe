/**
 * The top-level fields each op kind takes, and the fields of the new layer, patch or comment an add
 * op wraps. applyOps refuses anything else, so a misspelled or guessed field ("input" for "inputs",
 * "mode": "replace", a layer's "position" outside "props") fails with a did-you-mean instead of
 * being ignored.
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
  setNodePositions: ["component", "positions"],
  // Every op may name a component (it's ignored where there's none to target).
  setScript: ["component", "file", "source"],
  addAsset: ["component", "asset"],
  removeAsset: ["component", "id"],
  setProject: ["component", "changes"],
  addKnob: ["component", "knob", "index"],
  updateKnob: ["component", "id", "name", "group", "description", "type", "min", "max", "step", "unit", "options", "index"],
  removeKnob: ["component", "id"],
  setKnobValue: ["component", "id", "value", "preset"],
  addKnobPreset: ["component", "preset", "copyFrom", "index"],
  updateKnobPreset: ["component", "id", "name", "locked", "index"],
  removeKnobPreset: ["component", "id"],
  applyKnobPreset: ["component", "id"],
};

/** Ops that wrap a new item in one field, and that item's fields. */
const WRAPPED: Partial<Record<OpKind, { field: string; keys: readonly string[]; example: string }>> = {
  addLayer: { field: "layer", keys: ["ref", "id", "type", "name", "props", "children", "component"], example: '{ "op": "addLayer", "layer": { "type": "rectangle", "name": "Card" } }' },
  addPatch: { field: "patch", keys: ["ref", "id", "type", "name", "typeParam", "inputCount", "inputs", "settings", "component", "ui"], example: '{ "op": "addPatch", "patch": { "type": "switch", "name": "Liked" } }' },
  replacePatch: { field: "patch", keys: ["type", "typeParam", "inputCount", "settings", "name"], example: '{ "op": "replacePatch", "id": "spring", "patch": { "type": "classicAnimation" } }' },
  addComment: { field: "comment", keys: ["ref", "id", "text", "rect", "color"], example: '{ "op": "addComment", "comment": { "text": "Press states", "rect": [0, 0, 400, 200] } }' },
  addComponent: { field: "component", keys: ["id", "name", "kind", "interface", "layers", "patches", "comments", "notes", "size", "meta"], example: '{ "op": "addComponent", "component": { "name": "Card", "kind": "layerComponent" } }' },
  addKnob: { field: "knob", keys: ["id", "name", "type", "group", "description", "min", "max", "step", "unit", "options", "value", "values"], example: '{ "op": "addKnob", "knob": { "name": "Commit Distance", "type": "number", "value": 95 } }' },
  addKnobPreset: { field: "preset", keys: ["id", "name", "locked"], example: '{ "op": "addKnobPreset", "preset": { "name": "Shipped app" } }' },
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
  if (kind === "addLayer") checkLayerFields(op.layer, "layer");
  else if (kind === "addPatch" || kind === "addComment") checkItemFields(kind, op[WRAPPED[kind]!.field], WRAPPED[kind]!.field);
}

/** Where values by key go in each new item, for keys that look like one ("position" on a layer). */
const VALUES_FIELD: Partial<Record<OpKind, string>> = { addLayer: "props", addPatch: "inputs" };

/** Fail when the new item an add op wraps has a field it doesn't take. `at` is its path in the op. */
function checkItemFields(kind: OpKind, item: unknown, at: string): void {
  if (!item || typeof item !== "object" || Array.isArray(item)) return;
  const { keys, field } = WRAPPED[kind]!;
  for (const key of Object.keys(item)) {
    if (keys.includes(key)) continue;
    const guesses = didYouMean(key, keys);
    const values = VALUES_FIELD[kind];
    const where = values && !guesses.length ? ` Values by key, like "${key}", go inside "${values}": { "${field}": { "${values}": { "${key}": … } } }.` : "";
    fail("unknown_field", `${kind}'s "${at}" has no field "${key}".${didYouMeanText(guesses)}`, { hint: `A new ${field} takes: ${keys.join(", ")}.${where}` });
  }
}

function checkLayerFields(layer: unknown, at: string): void {
  checkItemFields("addLayer", layer, at);
  const children = (layer as { children?: unknown } | null)?.children;
  if (Array.isArray(children)) children.forEach((child, i) => checkLayerFields(child, `${at}.children[${i}]`));
}
