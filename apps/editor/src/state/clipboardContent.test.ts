import { applyOps, createEmptyDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { createMockRegistry, defineMock, port } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { base64ToBytes } from "./bytes.ts";
import { applyPastePlan, createClipboardFragment, parseClipboardFragment, planPaste, serializeClipboardFragment } from "./clipboard.ts";

const js = defineMock({ type: "javascript", name: "JavaScript", inputs: [], outputs: [port("output", "number")], evaluate: (ctx) => ctx.output("output", 1) });
const registry = createMockRegistry([js]);

function build(ops: Op[], doc: SonobeDocument = createEmptyDocument()): SonobeDocument {
  const result = applyOps(doc, ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

const PHOTO = { id: "photo", kind: "image" as const, name: "Photo", file: "abc123.png", sha256: "abc123" };

const source = () =>
  build([
    { op: "addAsset", asset: PHOTO },
    { op: "addLayer", layer: { id: "pic", type: "image", name: "Pic", props: { image: { asset: "photo" } } } },
    { op: "setScript", file: "js_1.js", source: "// one" },
    { op: "addPatch", patch: { id: "js", type: "javascript", settings: { script: "js_1.js" }, ui: { x: 10, y: 10 } } },
    { op: "addComment", comment: { id: "note", text: "Hello", rect: [0, 0, 200, 100], color: "yellow" } },
  ]);

const paste = (doc: SonobeDocument, text: string, offset: [number, number] = [24, 24]) => {
  const fragment = parseClipboardFragment(text)!;
  const plan = planPaste(doc, "main", fragment, { patchOffset: offset });
  return { plan, outcome: applyPastePlan(plan, (ops) => applyOps(doc, ops, { registry })) };
};

describe("clipboard content", () => {
  it("carries comments, script files, and asset bytes", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fragment = createClipboardFragment(source(), "main", { layers: ["pic"], patches: ["js"], comments: ["note"] }, { readAssetBytes: (r) => (r.file === PHOTO.file ? bytes : undefined) })!;
    expect(fragment.comments).toEqual([{ id: "note", text: "Hello", rect: [0, 0, 200, 100], color: "yellow" }]);
    expect(fragment.scripts).toEqual({ "js_1.js": "// one" });
    expect(base64ToBytes(fragment.assetData!.photo!)).toEqual(bytes);
    const text = serializeClipboardFragment(fragment);
    expect(parseClipboardFragment(text)).toEqual(fragment);

    const { plan, outcome } = paste(createEmptyDocument(), text);
    expect(plan.assetBytes[PHOTO.file]).toEqual(bytes);
    expect(outcome.result.ok).toBe(true);
    const doc = outcome.result.doc;
    expect(doc.components.main!.comments).toEqual([{ id: "note", text: "Hello", rect: [24, 24, 200, 100], color: "yellow" }]);
    expect(outcome.comments).toEqual(["note"]);
    expect(doc.scripts["js_1.js"]).toBe("// one");
    expect(doc.components.main!.patches.js!.settings).toEqual({ script: "js_1.js" });
    expect(doc.assets.photo).toMatchObject({ file: PHOTO.file });
  });

  it("gives a pasted script patch its own copy of a script another patch uses", () => {
    const text = serializeClipboardFragment(createClipboardFragment(source(), "main", { patches: ["js"] })!);
    const same = paste(source(), text);
    expect(same.plan.ops).toContainEqual({ op: "setScript", file: "js_1_2.js", source: "// one" });
    const doc = same.outcome.result.doc;
    expect(doc.components.main!.patches.js!.settings).toEqual({ script: "js_1.js" });
    expect(doc.components.main!.patches.js_2!.settings).toEqual({ script: "js_1_2.js" });
    expect(doc.scripts).toEqual({ "js_1.js": "// one", "js_1_2.js": "// one" });

    const conflicting = build([{ op: "setScript", file: "js_1.js", source: "// other" }]);
    const renamed = paste(conflicting, text);
    expect(renamed.plan.scriptFiles.get("js_1.js")).toBe("js_1_2.js");
    expect(renamed.outcome.result.doc.scripts).toEqual({ "js_1.js": "// other", "js_1_2.js": "// one" });
    expect(renamed.outcome.result.doc.components.main!.patches.js!.settings).toEqual({ script: "js_1_2.js" });
  });

  it("reuses an identical script nothing uses, shares one copy between patches that shared a file, and treats case variants as taken", () => {
    const shared = build([
      { op: "setScript", file: "js_1.js", source: "// one" },
      { op: "addPatch", patch: { id: "a", type: "javascript", settings: { script: "js_1.js" }, ui: { x: 0, y: 0 } } },
      { op: "addPatch", patch: { id: "b", type: "javascript", settings: { script: "js_1.js" }, ui: { x: 0, y: 100 } } },
    ]);
    const text = serializeClipboardFragment(createClipboardFragment(shared, "main", { patches: ["a", "b"] })!);

    const unused = build([{ op: "setScript", file: "js_1.js", source: "// one" }]);
    const reused = paste(unused, text);
    expect(reused.plan.ops.some((op) => op.op === "setScript")).toBe(false);
    expect(Object.values(reused.outcome.result.doc.components.main!.patches).map((p) => p.settings)).toEqual([{ script: "js_1.js" }, { script: "js_1.js" }]);

    const copied = paste(shared, text).outcome.result.doc;
    expect(copied.components.main!.patches.a_2!.settings).toEqual({ script: "js_1_2.js" });
    expect(copied.components.main!.patches.b_2!.settings).toEqual({ script: "js_1_2.js" });

    const upper = build([{ op: "setScript", file: "JS_1.js", source: "// shouting" }]);
    expect(paste(upper, text).plan.scriptFiles.get("js_1.js")).toBe("js_1_2.js");
  });

  it("reuses same-content assets and renames different media that share an id", () => {
    const text = serializeClipboardFragment(createClipboardFragment(source(), "main", { layers: ["pic"] })!);
    const sameContent = build([{ op: "addAsset", asset: { ...PHOTO, id: "hero" } }]);
    const reused = paste(sameContent, text);
    expect(reused.plan.ops.some((op) => op.op === "addAsset")).toBe(false);
    expect(reused.outcome.result.doc.components.main!.layers[0]!.props.image).toEqual({ asset: "hero" });

    const otherMedia = build([{ op: "addAsset", asset: { id: "photo", kind: "image", name: "Other", file: "zzz.png", sha256: "zzz" } }]);
    const renamed = paste(otherMedia, text);
    expect(renamed.plan.assetIds.get("photo")).toBe("photo_2");
    expect(renamed.outcome.result.doc.assets.photo_2).toMatchObject({ file: PHOTO.file, name: "Photo" });
    expect(renamed.outcome.result.doc.components.main!.layers[0]!.props.image).toEqual({ asset: "photo_2" });
  });

  it("leaves large bytes out and accepts comment-only fragments", () => {
    const doc = source();
    const small = createClipboardFragment(doc, "main", { layers: ["pic"] }, { readAssetBytes: () => new Uint8Array(8), maxAssetBytes: 4 })!;
    expect(small.assetData).toBeUndefined();
    const notes = createClipboardFragment(doc, "main", { comments: ["note"] })!;
    expect(notes).toMatchObject({ layers: [], patches: {}, comments: [{ id: "note" }] });
    expect(createClipboardFragment(doc, "main", { comments: ["ghost"] })).toBeNull();
    const second = paste(doc, serializeClipboardFragment(notes)).outcome;
    expect(second.comments).toEqual(["note_2"]);
  });

  it("parses older fragments and rejects malformed new fields", () => {
    expect(parseClipboardFragment(JSON.stringify({ type: "sonobe/clipboard", formatVersion: 1, layers: [], patches: {}, assets: {}, components: { x: { id: "y" } } }))).toBeNull();
    const legacy = JSON.stringify({ type: "sonobe/clipboard", formatVersion: 1, layers: [], patches: {}, assets: {} });
    expect(parseClipboardFragment(legacy)).toEqual({ type: "sonobe/clipboard", formatVersion: 1, layers: [], patches: {}, assets: {} });
    expect(parseClipboardFragment(JSON.stringify({ type: "sonobe/clipboard", formatVersion: 1, layers: [], patches: {}, assets: {}, comments: [{ id: "x", text: "hi", rect: [0, 0] }] }))).toBeNull();
    expect(parseClipboardFragment(JSON.stringify({ type: "sonobe/clipboard", formatVersion: 1, layers: [], patches: {}, assets: {}, scripts: { "a.js": 3 } }))).toBeNull();
  });
});

describe("clipboard: component instances", () => {
  /** A layer component "button" (with an "icon" instance inside), a patch component "counter", and a card using the button. */
  const withComponents = (extra: Op[] = []) =>
    build([
      { op: "addComponent", component: { id: "icon", name: "Icon", kind: "layerComponent" } },
      { op: "addLayer", component: "icon", layer: { id: "glyph", type: "rectangle", name: "Glyph" } },
      { op: "addComponent", component: { id: "button", name: "Button", kind: "layerComponent" } },
      { op: "addLayer", component: "button", layer: { id: "bg", type: "rectangle", name: "Bg" } },
      { op: "addLayer", component: "button", layer: { id: "mark", type: "componentInstance", name: "Mark", component: "icon" } },
      { op: "addComponent", component: { id: "counter", name: "Counter", kind: "patchComponent" } },
      { op: "addLayer", layer: { id: "card", type: "group", name: "Card", children: [{ id: "shape", type: "rectangle", name: "Shape" }, { id: "cta", type: "componentInstance", name: "CTA", component: "button" }] } },
      { op: "addLayer", layer: { id: "plain", type: "rectangle", name: "Plain" } },
      { op: "addPatch", patch: { id: "count", type: "component", component: "counter", ui: { x: 0, y: 0 } } },
      ...extra,
    ]);
  const copyCard = (doc: SonobeDocument) => serializeClipboardFragment(createClipboardFragment(doc, "main", { layers: ["card", "plain"], patches: ["count"] })!);

  it("carries the components instances show and adds them where you paste", () => {
    const text = copyCard(withComponents());
    expect(Object.keys(parseClipboardFragment(text)!.components!).sort()).toEqual(["button", "counter", "icon"]);
    const { plan, outcome } = paste(createEmptyDocument(), text);
    expect(outcome.result.ok).toBe(true);
    expect(plan.ops.filter((op) => op.op === "addComponent").map((op) => (op as Extract<Op, { op: "addComponent" }>).component.id)).toEqual(["icon", "button", "counter"]);
    const doc = outcome.result.doc;
    expect(Object.keys(doc.components).sort()).toEqual(["button", "counter", "icon", "main"]);
    expect(doc.components.button!.layers.map((l) => l.id)).toEqual(["bg", "mark"]);
    expect(doc.components.main!.layers.map((l) => l.id)).toEqual(["card", "plain"]);
    expect(doc.components.main!.layers[0]!.children![1]).toMatchObject({ type: "componentInstance", component: "button" });
    expect(doc.components.main!.patches.count).toMatchObject({ type: "component", component: "counter" });
    expect(outcome.droppedInstances).toBe(0);
  });

  it("renames a component whose id is taken by another kind here", () => {
    const target = build([{ op: "addComponent", component: { id: "button", name: "Not A Button", kind: "patchComponent" } }]);
    const { plan, outcome } = paste(target, copyCard(withComponents()));
    expect(outcome.result.ok).toBe(true);
    expect(plan.componentIds.get("button")).toBe("button_2");
    const doc = outcome.result.doc;
    expect(doc.components.button!.kind).toBe("patchComponent");
    expect(doc.components.button_2!.kind).toBe("layerComponent");
    expect(doc.components.main!.layers[0]!.children![1]!.component).toBe("button_2");
  });

  it("re-adds a component deleted since the copy", () => {
    const doc = withComponents();
    const text = copyCard(doc);
    const deleted = applyOps(doc, [{ op: "removeLayer", id: "card" }, { op: "removePatch", id: "count" }, { op: "removeComponent", id: "button" }, { op: "removeComponent", id: "counter" }], { registry }).doc;
    const { outcome } = paste(deleted, text);
    expect(outcome.result.ok).toBe(true);
    expect(outcome.result.doc.components.button!.layers.map((l) => l.id)).toEqual(["bg", "mark"]);
  });

  it("leaves out instances it can't resolve and pastes the rest", () => {
    const legacy = JSON.parse(copyCard(withComponents())) as Record<string, unknown>;
    delete legacy.components;
    const { outcome } = paste(createEmptyDocument(), JSON.stringify(legacy));
    expect(outcome.result.ok).toBe(true);
    expect(outcome.droppedInstances).toBe(2);
    expect(outcome.result.doc.components.main!.layers[0]!.children!.map((l) => l.id)).toEqual(["shape"]);
    expect(outcome.result.doc.components.main!.layers.map((l) => l.id)).toEqual(["card", "plain"]);
    expect(outcome.result.doc.components.main!.patches).toEqual({});
  });

  it("won't paste an instance into the component it shows", () => {
    const doc = withComponents();
    const fragment = parseClipboardFragment(copyCard(doc))!;
    const plan = planPaste(doc, "button", fragment);
    const outcome = applyPastePlan(plan, (ops) => applyOps(doc, ops, { registry }));
    expect(outcome.result.ok).toBe(true);
    expect(outcome.droppedInstances).toBe(1);
    expect(outcome.result.doc.components.button!.layers.map((l) => l.id)).toEqual(["bg", "mark", "card", "plain"]);
  });

  it("pastes without a component whose definition can't be added", () => {
    const doc = applyOps(withComponents(), [{ op: "updateComponent", id: "icon", notes: "x" }], { registry }).doc;
    const fragment = parseClipboardFragment(copyCard(doc))!;
    // A definition with problems (a link to a patch that doesn't exist) that addComponent refuses.
    fragment.components!.icon!.layers[0]!.props.opacity = { link: "ghost.output" };
    const { outcome } = paste(createEmptyDocument(), serializeClipboardFragment(fragment));
    expect(outcome.result.ok).toBe(true);
    expect(Object.keys(outcome.result.doc.components).sort()).toEqual(["counter", "main"]);
    expect(outcome.droppedInstances).toBe(1);
    expect(outcome.result.doc.components.main!.layers[0]!.children!.map((l) => l.id)).toEqual(["shape"]);
  });
});
