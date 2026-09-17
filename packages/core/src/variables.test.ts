import { describe, expect, it } from "vitest";
import { getDiagnostics } from "./diagnostics.ts";
import { patchDisplayName } from "./names.ts";
import { applyOps, type ApplyOpsResult } from "./ops/index.ts";
import { createRegistry, getPatchSpec } from "./registry.ts";
import { emptyDoc, MOCK_PATCH_SPECS, port } from "./testing/fixtures.ts";
import type { Id, Op, PatchSpec, SonobeDocument } from "./types.ts";
import { followingReceivers, reachableVariables, resolveReceiver } from "./variables.ts";

const settings: PatchSpec["settings"] = [
  { key: "name", name: "Name", type: "text", default: "", description: "The variable's name." },
  { key: "scope", name: "Scope", type: "enum", default: "local", enumOptions: [{ key: "local", name: "Local" }, { key: "global", name: "Global" }], description: "Where it reaches." },
];

const registry = createRegistry([
  ...MOCK_PATCH_SPECS,
  { type: "variableBroadcaster", name: "Variable Broadcaster", category: "utility", summary: "Shares a value.", variants: ["number", "boolean"], settings, inputs: [port("value", "variant", { default: 0 })], outputs: [] },
  { type: "variableReceiver", name: "Variable Receiver", category: "utility", summary: "Reads a value.", variants: ["number", "boolean"], settings, inputs: [], outputs: [port("output", "variant")] },
]);

function apply(doc: SonobeDocument, ops: Op[]): ApplyOpsResult {
  const r = applyOps(doc, ops, { registry });
  if (!r.ok) throw new Error(JSON.stringify(r.errors, null, 2));
  return r;
}

const build = (ops: Op[], doc: SonobeDocument = emptyDoc()) => apply(doc, ops).doc;

/** Undo, then redo, the way the document store replays history (lenient). */
function roundTrip(before: SonobeDocument, r: ApplyOpsResult) {
  const undo = applyOps(r.doc, r.inverse, { registry, lenient: true });
  expect(undo.ok).toBe(true);
  expect(undo.doc).toStrictEqual(before);
  const redo = applyOps(before, r.applied, { registry, lenient: true });
  expect(redo.ok).toBe(true);
  expect(redo.doc).toStrictEqual(r.doc);
}

const patch = (doc: SonobeDocument, id: Id, component: Id = "main") => doc.components[component]!.patches[id]!;

const base = () =>
  build([
    { op: "addPatch", patch: { id: "liked", type: "variableBroadcaster", settings: { name: "isLiked" }, ui: { x: 0, y: 0 } } },
    { op: "addPatch", patch: { id: "reader", type: "variableReceiver", settings: { name: "isLiked" }, ui: { x: 300, y: 0 } } },
    { op: "addPatch", patch: { id: "other", type: "variableReceiver", settings: { name: "count" }, ui: { x: 300, y: 200 } } },
  ]);

/** A global variable in main, read in main and inside Card; Badge (inside Card) overrides it. */
const nested = () =>
  build([
    { op: "addComponent", component: { id: "card", name: "Card", kind: "layerComponent" } },
    { op: "addComponent", component: { id: "badge", name: "Badge", kind: "layerComponent" } },
    { op: "addPatch", patch: { id: "liked", type: "variableBroadcaster", settings: { name: "isLiked", scope: "global" }, ui: { x: 0, y: 0 } } },
    { op: "addPatch", patch: { id: "here", type: "variableReceiver", settings: { name: "isLiked", scope: "global" }, ui: { x: 300, y: 0 } } },
    { op: "addPatch", component: "card", patch: { id: "inside", type: "variableReceiver", settings: { name: "isLiked", scope: "global" }, ui: { x: 0, y: 0 } } },
    { op: "addPatch", component: "badge", patch: { id: "override", type: "variableBroadcaster", settings: { name: "isLiked", scope: "global" }, ui: { x: 0, y: 0 } } },
    { op: "addPatch", component: "badge", patch: { id: "shadowed", type: "variableReceiver", settings: { name: "isLiked", scope: "global" }, ui: { x: 0, y: 200 } } },
    { op: "addLayer", layer: { id: "card_1", type: "componentInstance", component: "card" } },
    { op: "addLayer", component: "card", layer: { id: "badge_1", type: "componentInstance", component: "badge" } },
  ]);

describe("renaming a Variable Broadcaster", () => {
  it("names the variable, clears a separate title, and brings its receivers along in one undoable batch", () => {
    const before = build([{ op: "updatePatch", id: "liked", name: "Old title" }], base());
    const r = apply(before, [{ op: "rename", id: "liked", name: " hearted " }]);
    expect(patch(r.doc, "liked").settings).toEqual({ name: "hearted" });
    expect(patch(r.doc, "liked").name).toBeUndefined();
    expect(patchDisplayName(patch(r.doc, "liked"), getPatchSpec(registry, "variableBroadcaster"))).toBe("hearted");
    expect(patch(r.doc, "reader").settings).toEqual({ name: "hearted" });
    expect(patch(r.doc, "other").settings).toEqual({ name: "count" });
    expect(resolveReceiver(r.doc, registry, ["main"], "reader").broadcaster?.id).toBe("liked");
    roundTrip(before, r);
  });

  it("leaves receivers alone when the name is emptied, so naming it back reconnects them", () => {
    const r = apply(base(), [{ op: "rename", id: "liked", name: "" }]);
    expect(patch(r.doc, "liked").settings).toBeUndefined();
    expect(patch(r.doc, "reader").settings).toEqual({ name: "isLiked" });
    expect(resolveReceiver(r.doc, registry, ["main"], "reader").broadcaster).toBeNull();
    const back = apply(r.doc, [{ op: "rename", id: "liked", name: "isLiked" }]);
    expect(resolveReceiver(back.doc, registry, ["main"], "reader").broadcaster?.id).toBe("liked");
  });

  it("follows name, scope, and type changes, down into components placed inside, until another broadcaster takes over", () => {
    const before = nested();
    expect(followingReceivers(before, registry, "main", "liked")).toEqual([
      { componentId: "main", id: "here" },
      { componentId: "card", id: "inside" },
    ]);
    const r = apply(before, [{ op: "updatePatch", id: "liked", typeParam: "boolean", settings: { name: "liked" } }]);
    expect(patch(r.doc, "here")).toMatchObject({ typeParam: "boolean", settings: { name: "liked", scope: "global" } });
    expect(patch(r.doc, "inside", "card")).toMatchObject({ typeParam: "boolean", settings: { name: "liked", scope: "global" } });
    expect(patch(r.doc, "shadowed", "badge")).toMatchObject({ settings: { name: "isLiked", scope: "global" } });
    expect(patch(r.doc, "shadowed", "badge").typeParam).toBe(patch(before, "shadowed", "badge").typeParam);
    roundTrip(before, r);

    const local = apply(r.doc, [{ op: "updatePatch", id: "liked", settings: { scope: "local" } }]);
    expect(patch(local.doc, "here").settings).toEqual({ name: "liked" });
    roundTrip(r.doc, local);
  });

  it("has no followers while a duplicate with a lower id wins, and replaying history doesn't cascade", () => {
    const doc = build([{ op: "addPatch", patch: { id: "unused_copy", type: "variableBroadcaster", settings: { name: "isLiked" }, ui: { x: 0, y: 400 } } }], base());
    expect(followingReceivers(doc, registry, "main", "liked")).toEqual([{ componentId: "main", id: "reader" }]);
    expect(followingReceivers(doc, registry, "main", "unused_copy")).toEqual([]);
    const replayed = applyOps(base(), [{ op: "updatePatch", id: "liked", settings: { name: "renamed" } }], { registry, lenient: true });
    expect(patch(replayed.doc, "reader").settings).toEqual({ name: "isLiked" });
  });
});

describe("reachableVariables", () => {
  it("lists this component's variables, then globals from enclosing components, nearest first", () => {
    const doc = build([
      { op: "addComponent", component: { id: "card", name: "Card", kind: "layerComponent" } },
      { op: "addPatch", patch: { id: "theme", type: "variableBroadcaster", typeParam: "boolean", settings: { name: "dark", scope: "global" }, ui: { x: 0, y: 0 } } },
      { op: "addPatch", patch: { id: "secret", type: "variableBroadcaster", settings: { name: "count" }, ui: { x: 0, y: 200 } } },
      { op: "addPatch", component: "card", patch: { id: "size", type: "variableBroadcaster", settings: { name: "size" }, ui: { x: 0, y: 0 } } },
      { op: "addPatch", component: "card", patch: { id: "unnamed", type: "variableBroadcaster", ui: { x: 0, y: 200 } } },
      { op: "addLayer", layer: { id: "card_1", type: "componentInstance", component: "card" } },
    ]);
    expect(reachableVariables(doc, registry, ["main", "card"]).map((v) => [v.componentId, v.id, v.name, v.scope, v.type])).toEqual([
      ["card", "size", "size", "local", "number"],
      ["main", "theme", "dark", "global", "boolean"],
    ]);
    const receiver = build([{ op: "addPatch", component: "card", patch: { id: "r", type: "variableReceiver", typeParam: "number", settings: { name: "dark", scope: "global" }, ui: { x: 300, y: 0 } } }], doc);
    expect(resolveReceiver(receiver, registry, ["main", "card"], "r")).toEqual({ broadcaster: null, mismatch: true });
  });
});

describe("variable diagnostics", () => {
  it("flags unnamed, duplicate, and unused broadcasters", () => {
    const doc = build([
      { op: "addPatch", patch: { id: "blank", type: "variableBroadcaster", ui: { x: 0, y: 0 } } },
      { op: "addPatch", patch: { id: "a", type: "variableBroadcaster", settings: { name: "total" }, ui: { x: 0, y: 200 } } },
      { op: "addPatch", patch: { id: "b", type: "variableBroadcaster", settings: { name: "total" }, ui: { x: 0, y: 400 } } },
      { op: "addPatch", patch: { id: "lonely", type: "variableBroadcaster", settings: { name: "nobody" }, ui: { x: 0, y: 600 } } },
      { op: "addPatch", patch: { id: "r", type: "variableReceiver", settings: { name: "total" }, ui: { x: 300, y: 0 } } },
    ]);
    const found = getDiagnostics(doc, registry).filter((d) => d.code.endsWith("_variable"));
    expect(found.map((d) => [d.severity, d.code, d.itemIds])).toEqual([
      ["warning", "unnamed_variable", ["blank"]],
      ["error", "duplicate_variable", ["a", "b"]],
      ["info", "unused_variable", ["lonely"]],
    ]);
    expect(found[0]!.message).toBe('"Variable Broadcaster" has no name, so no Variable Receiver can read its value.');
    expect(found[1]!.message).toBe('2 broadcasters in Main share the local variable "total", so receivers read only "total" (Variable Broadcaster).');
  });
});
