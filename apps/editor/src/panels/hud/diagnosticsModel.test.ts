import { applyOps, createEmptyDocument, getDiagnostics, type Diagnostic, type SonobeDocument } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { CLAUDE_AUTHOR, createDocumentStore } from "../../state/document.ts";
import { adviceSuggestions, applyDiagnosticFix, countBySeverity, filterDiagnostics, fixableSuggestions, fixLabel, mergeDiagnostics } from "./diagnosticsModel.ts";

const registry = createPatchRegistry();

/** Built by hand: ops refuse dangling links and unknown patch types. */
function brokenDocument(): SonobeDocument {
  const r = applyOps(
    createEmptyDocument(),
    [
      { op: "addLayer", layer: { id: "box", type: "rectangle" } },
      { op: "addPatch", patch: { id: "tap", type: "interaction" } },
      { op: "addPatch", patch: { id: "toggle", type: "switch" } },
    ],
    { registry },
  );
  expect(r.ok).toBe(true);
  const main = r.doc.components.main!;
  return {
    ...r.doc,
    components: {
      ...r.doc.components,
      main: {
        ...main,
        layers: main.layers.map((layer) => (layer.id === "box" ? { ...layer, props: { ...layer.props, opacity: { link: "tap.tap" } } } : layer)),
        patches: {
          ...main.patches,
          toggle: { ...main.patches.toggle!, inputs: { flip: { link: "gone.tap" } } },
          spring: { type: "popAnimaton", inputs: {}, ui: { x: 0, y: 0 } },
        },
      },
    },
  };
}

describe("merging and filtering", () => {
  const d = (severity: Diagnostic["severity"], code: string, itemIds: string[] = []): Diagnostic => ({ severity, code, message: code, component: "main", itemIds });

  it("merges document and runtime diagnostics without duplicates, errors first", () => {
    const merged = mergeDiagnostics([d("info", "unused"), d("warning", "pulse_into_state", ["a"]), d("error", "dangling_link", ["b"])], [d("error", "dangling_link", ["b"]), d("warning", "unimplemented_patch", ["c"])]);
    expect(merged.map((x) => [x.code, x.source])).toEqual([
      ["dangling_link", "document"],
      ["pulse_into_state", "document"],
      ["unimplemented_patch", "runtime"],
      ["unused", "document"],
    ]);
    expect(new Set(merged.map((x) => x.key)).size).toBe(4);
    const runtimeRepeat = mergeDiagnostics(
      [d("error", "unknown_patch_type", ["spring"]), d("error", "dangling_link", ["fade", "old_tap"])],
      [{ ...d("error", "unknown_patch_type", ["spring"]), message: "Patch spring doesn't run." }, { ...d("warning", "dangling_link", ["fade"]), message: "fade reads old_tap.tap" }, d("error", "unknown_patch_type", ["other"])],
    );
    expect(runtimeRepeat.map((x) => [x.code, x.itemIds[0], x.source])).toEqual([
      ["unknown_patch_type", "spring", "document"],
      ["dangling_link", "fade", "document"],
      ["unknown_patch_type", "other", "runtime"],
    ]);
    expect(countBySeverity(merged)).toEqual({ error: 1, warning: 2, info: 1 });
    expect(filterDiagnostics(merged, { error: false, warning: true, info: false }).map((x) => x.code)).toEqual(["pulse_into_state", "unimplemented_patch"]);
  });

  it("separates fixes from advice and shortens labels", () => {
    const diagnostic: Diagnostic = { ...d("warning", "x"), suggestions: [{ description: "Insert a Switch: each pulse flips it on or off, and it holds that state.", ops: [{ op: "removePatch", id: "a" }] }, { description: "Check the layer is enabled." }, { description: "Empty", ops: [] }] };
    expect(fixableSuggestions(diagnostic).map((s) => s.description)).toEqual(["Insert a Switch: each pulse flips it on or off, and it holds that state."]);
    expect(adviceSuggestions(diagnostic).map((s) => s.description)).toEqual(["Check the layer is enabled.", "Empty"]);
    expect(fixLabel({ description: "Insert a Switch: each pulse flips it." })).toBe("Insert a Switch");
    expect(fixLabel({ description: 'Remove "spring"' })).toBe('Remove "spring"');
    expect(fixLabel({ description: "Use 1.5 instead." })).toBe("Use 1.5 instead");
  });
});

describe("applying fixes", () => {
  it("applies a suggestion as one labeled history change and clears the diagnostic", () => {
    const store = createDocumentStore({ registry, document: brokenDocument() });
    const dangling = getDiagnostics(store.getState().doc, registry).find((x) => x.code === "dangling_link")!;
    expect(dangling).toBeDefined();
    const disconnect = fixableSuggestions(dangling).find((s) => /disconnect/i.test(s.description))!;

    const outcome = applyDiagnosticFix(store, dangling, disconnect);
    expect(outcome).toMatchObject({ ok: true, label: "Disconnect it" });
    const after = store.getState();
    expect(after.doc.components.main!.patches.toggle!.inputs.flip).toBeUndefined();
    expect(getDiagnostics(after.doc, registry).some((x) => x.code === "dangling_link")).toBe(false);
    expect(after.historyEntries(1)[0]).toMatchObject({ label: "Disconnect it", author: { kind: "human" } });
    expect(after).toMatchObject({ dirty: true, canUndo: true });
  });

  it("inserts a converter patch for a pulse wired into state, and undo brings the warning back", () => {
    const store = createDocumentStore({ registry, document: brokenDocument() });
    const warning = getDiagnostics(store.getState().doc, registry).find((x) => x.code === "pulse_into_state")!;
    expect(warning).toBeDefined();
    const insert = fixableSuggestions(warning)[0]!;
    expect(insert.description).toMatch(/switch/i);

    const outcome = applyDiagnosticFix(store, warning, insert);
    expect(outcome.ok, outcome.message).toBe(true);
    expect(outcome.label).toBe("Insert a Switch");
    const fixed = store.getState().doc;
    expect(Object.values(fixed.components.main!.patches).filter((p) => p.type === "switch")).toHaveLength(2);
    expect(getDiagnostics(fixed, registry).some((x) => x.code === "pulse_into_state")).toBe(false);

    expect(store.getState().undo().ok).toBe(true);
    expect(getDiagnostics(store.getState().doc, registry).some((x) => x.code === "pulse_into_state")).toBe(true);
  });

  it("targets the diagnostic's component for ops without one and records the author", () => {
    const added = applyOps(createEmptyDocument(), [{ op: "addComponent", component: { name: "Card", kind: "patchComponent" } }], { registry });
    const card = Object.keys(added.doc.components).find((id) => id !== "main")!;
    const component = added.doc.components[card]!;
    const doc: SonobeDocument = { ...added.doc, components: { ...added.doc.components, [card]: { ...component, patches: { spring: { type: "popAnimaton", inputs: {}, ui: { x: 0, y: 0 } } } } } };
    const store = createDocumentStore({ registry, document: doc });

    const outcome = applyDiagnosticFix(store, { component: card }, { description: 'Remove "spring"', ops: [{ op: "removePatch", id: "spring" }] }, CLAUDE_AUTHOR);
    expect(outcome.ok, outcome.message).toBe(true);
    expect(store.getState().doc.components[card]!.patches.spring).toBeUndefined();
    expect(store.getState().historyEntries(1)[0]!.author).toEqual(CLAUDE_AUTHOR);
  });

  it("leaves the document untouched when a fix no longer applies", () => {
    const store = createDocumentStore({ registry, document: brokenDocument() });
    const unknown = getDiagnostics(store.getState().doc, registry).find((x) => x.code === "unknown_patch_type")!;
    expect(unknown.message).toMatch(/popAnimation/);
    const remove = fixableSuggestions(unknown)[0]!;
    expect(applyDiagnosticFix(store, unknown, remove).ok).toBe(true);
    const revision = store.getState().revision;
    const doc = store.getState().doc;

    const stale = applyDiagnosticFix(store, unknown, remove);
    expect(stale.ok).toBe(false);
    expect(stale.message).toBeTruthy();
    expect(store.getState().doc).toBe(doc);
    expect(store.getState().revision).toBe(revision);
  });
});
