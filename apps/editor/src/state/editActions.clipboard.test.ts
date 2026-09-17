import { createEmptyDocument, type Op } from "@sonobe/core";
import { defineMock, MOCK_DEFINITIONS, port } from "@sonobe/engine/testing";
import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, describe, expect, it } from "vitest";
import { createManualScheduler } from "../runtime/scheduler.ts";
import { createDialogStore } from "./dialogs.ts";
import { copySelection, cutSelection, duplicateSelection, pasteFragment } from "./editActions.ts";
import { createEditorSession, type EditorSession } from "./session.ts";

const js = defineMock({ type: "javascript", name: "JavaScript", inputs: [], outputs: [port("output", "number")], evaluate: (ctx) => ctx.output("output", 1) });
const registry = createPatchRegistry({ definitions: [...MOCK_DEFINITIONS, js] });
const sessions: EditorSession[] = [];

const make = () => {
  const session = createEditorSession({ host: null, dialogStore: createDialogStore(), registry, document: createEmptyDocument(), autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate", platform: null });
  sessions.push(session);
  return session;
};

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
});

describe("edit actions: clipboard content", () => {
  it("copies comments, scripts, and asset bytes into another prototype", async () => {
    const a = make();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const imported = await a.assets.importFile({ name: "photo.png", bytes: png });
    const ops: Op[] = [
      { op: "addLayer", layer: { id: "pic", type: "image", name: "Pic", props: { image: { asset: imported.assetId! } } } },
      { op: "setScript", file: "js_1.js", source: "// hi" },
      { op: "addPatch", patch: { id: "js_1", type: "javascript", settings: { script: "js_1.js" }, ui: { x: 0, y: 0 } } },
      { op: "addComment", comment: { id: "note", text: "Remember", rect: [0, 0, 100, 50] } },
    ];
    expect(a.document.getState().apply(ops, { label: "Build" }).ok).toBe(true);
    a.selection.getState().select({ layers: ["pic"], patches: ["js_1"], comments: ["note"] });
    const fragment = copySelection(a)!;
    expect(fragment).toMatchObject({ comments: [{ id: "note" }], scripts: { "js_1.js": "// hi" }, assetData: { [imported.assetId!]: expect.any(String) } });
    expect(a.clipboard).toBe(fragment);

    const b = make();
    const pasted = pasteFragment(b, fragment);
    expect(pasted).toMatchObject({ ok: true, layers: ["pic"], patches: ["js_1"], comments: ["note"] });
    const doc = b.document.getState().doc;
    expect(doc.scripts["js_1.js"]).toBe("// hi");
    expect(doc.assets[imported.assetId!]).toEqual(imported.record);
    expect(doc.components.main!.comments).toEqual([{ id: "note", text: "Remember", rect: [0, 0, 100, 50] }]);
    expect(new Uint8Array(b.assets.peekBytes(imported.record!.file)!)).toEqual(png);
    expect(b.resolveAssetUrl(imported.assetId!)).toMatch(/^blob:/);
    expect(b.selection.getState()).toMatchObject({ layers: ["pic"], patches: ["js_1"], comments: ["note"] });
    expect(b.document.getState().historyEntries().map((e) => e.label)).toEqual(["Paste 3 items"]);
  });

  it("pastes layers with component instances into another prototype", () => {
    const a = make();
    const ops: Op[] = [
      { op: "addComponent", component: { id: "button", name: "Button", kind: "layerComponent" } },
      { op: "addLayer", component: "button", layer: { id: "bg", type: "rectangle", name: "Bg" } },
      { op: "addLayer", layer: { id: "card", type: "group", name: "Card", children: [{ id: "cta", type: "componentInstance", name: "CTA", component: "button" }] } },
      { op: "addLayer", layer: { id: "plain", type: "rectangle", name: "Plain" } },
    ];
    expect(a.document.getState().apply(ops, { label: "Build" }).ok).toBe(true);
    a.selection.getState().select({ layers: ["card", "plain"] });
    const fragment = copySelection(a)!;

    const b = make();
    expect(pasteFragment(b, fragment)).toMatchObject({ ok: true, layers: ["card", "plain"], droppedInstances: 0 });
    expect(b.document.getState().doc.components.button!.layers.map((l) => l.id)).toEqual(["bg"]);
  });

  it("duplicating a JavaScript patch gives the copy its own script file", () => {
    const s = make();
    const ops: Op[] = [
      { op: "setScript", file: "js_1.js", source: "// hi" },
      { op: "addPatch", patch: { id: "js_1", type: "javascript", settings: { script: "js_1.js" }, ui: { x: 0, y: 0 } } },
    ];
    expect(s.document.getState().apply(ops, { label: "Build" }).ok).toBe(true);
    s.selection.getState().select({ patches: ["js_1"] });
    expect(duplicateSelection(s)).toMatchObject({ ok: true, patches: ["js_2"] });
    const doc = s.document.getState().doc;
    expect(doc.components.main!.patches.js_2!.settings).toEqual({ script: "js_1_2.js" });
    expect(doc.scripts).toEqual({ "js_1.js": "// hi", "js_1_2.js": "// hi" });
  });

  it("duplicates and cuts comments", () => {
    const s = make();
    s.document.getState().apply([{ op: "addComment", comment: { id: "note", text: "Remember", rect: [10, 10, 100, 50] } }], { label: "Comment" });
    s.selection.getState().select({ comments: ["note"] });
    expect(duplicateSelection(s)).toMatchObject({ ok: true, comments: ["note_2"] });
    // The copy steps diagonally (24 pt steps) until it clears the original 100 × 50 frame.
    expect(s.document.getState().doc.components.main!.comments.map((c) => c.rect)).toEqual([
      [10, 10, 100, 50],
      [82, 82, 100, 50],
    ]);
    s.selection.getState().select({ comments: ["note_2"] });
    expect(cutSelection(s)).toMatchObject({ ok: true, fragment: { comments: [{ id: "note_2" }] } });
    expect(s.document.getState().doc.components.main!.comments.map((c) => c.id)).toEqual(["note"]);
    expect(s.selection.getState().comments).toEqual([]);
  });
});
