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

  it("reuses identical scripts and renames conflicting ones", () => {
    const text = serializeClipboardFragment(createClipboardFragment(source(), "main", { patches: ["js"] })!);
    const same = paste(source(), text);
    expect(same.plan.ops.some((op) => op.op === "setScript")).toBe(false);
    expect(same.outcome.result.doc.components.main!.patches.js_2!.settings).toEqual({ script: "js_1.js" });

    const conflicting = build([{ op: "setScript", file: "js_1.js", source: "// other" }]);
    const renamed = paste(conflicting, text);
    expect(renamed.plan.scriptFiles.get("js_1.js")).toBe("js_1_2.js");
    expect(renamed.outcome.result.doc.scripts).toEqual({ "js_1.js": "// other", "js_1_2.js": "// one" });
    expect(renamed.outcome.result.doc.components.main!.patches.js!.settings).toEqual({ script: "js_1_2.js" });
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
    const legacy = JSON.stringify({ type: "sonobe/clipboard", formatVersion: 1, layers: [], patches: {}, assets: {} });
    expect(parseClipboardFragment(legacy)).toEqual({ type: "sonobe/clipboard", formatVersion: 1, layers: [], patches: {}, assets: {} });
    expect(parseClipboardFragment(JSON.stringify({ type: "sonobe/clipboard", formatVersion: 1, layers: [], patches: {}, assets: {}, comments: [{ id: "x", text: "hi", rect: [0, 0] }] }))).toBeNull();
    expect(parseClipboardFragment(JSON.stringify({ type: "sonobe/clipboard", formatVersion: 1, layers: [], patches: {}, assets: {}, scripts: { "a.js": 3 } }))).toBeNull();
  });
});
