import { applyOps, createEmptyDocument, findLayer, type Op, type SonobeDocument } from "@sonobe/core";
import { afterEach, describe, expect, it } from "vitest";
import { estimatePatchSize } from "../panels/patch-editor/model/placement.ts";
import { createManualScheduler } from "../runtime/scheduler.ts";
import {
  arrangeLayers,
  copySelection,
  createComponentFromSelection,
  deleteSelection,
  duplicateSelection,
  enterSelectedComponent,
  exitComponent,
  freePasteOffset,
  groupSelection,
  pasteFragment,
  selectAll,
  toggleLayerLock,
  toggleLayerVisibility,
  ungroupSelection,
} from "./editActions.ts";
import { getRegistry } from "./registry.ts";
import { createEditorSession, type EditorSession } from "./session.ts";

const registry = getRegistry();
let session: EditorSession | null = null;

afterEach(() => {
  session?.dispose();
  session = null;
});

function build(ops: Op[]): SonobeDocument {
  const result = applyOps(createEmptyDocument(), ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

function start(doc: SonobeDocument): EditorSession {
  session = createEditorSession({ host: null, registry, document: doc, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  return session;
}

const main = (s: EditorSession) => s.document.getState().doc.components.main!;
const ids = (s: EditorSession) => main(s).layers.map((l) => l.id);
const props = (s: EditorSession, id: string) => findLayer(main(s).layers, id)!.layer.props;

const twoRects = () =>
  build([
    { op: "addLayer", layer: { id: "a", type: "rectangle", name: "A", props: { position: [10, 20], size: [50, 50] } } },
    { op: "addLayer", layer: { id: "b", type: "rectangle", name: "B", props: { position: [100, 40], size: [20, 30] } } },
    { op: "addLayer", layer: { id: "c", type: "oval", name: "C" } },
    { op: "addPatch", patch: { id: "tap", type: "interaction", inputs: { layer: { layer: "a" } } } },
  ]);

describe("edit actions", () => {
  it("deletes layers and patches in one undoable step", () => {
    const s = start(twoRects());
    s.selection.getState().select({ layers: ["a"], patches: ["tap"] });
    expect(deleteSelection(s).ok).toBe(true);
    expect(ids(s)).toEqual(["b", "c"]);
    expect(main(s).patches.tap).toBeUndefined();
    expect(s.selection.getState().layers).toEqual([]);
    expect(s.document.getState().undoLabel).toBe("You: Delete 2 items (2 ops)");
    s.document.getState().undo();
    expect(ids(s)).toEqual(["a", "b", "c"]);
    expect(main(s).patches.tap!.inputs.layer).toEqual({ layer: "a" });
  });

  it("duplicates in front of the original and selects the copy", () => {
    const s = start(twoRects());
    s.selection.getState().select({ layers: ["a"] });
    const result = duplicateSelection(s);
    expect(result.ok).toBe(true);
    expect(ids(s)).toEqual(["a", "a_2", "b", "c"]);
    expect(s.selection.getState().layers).toEqual(["a_2"]);
    expect(props(s, "a_2")).toEqual({ position: [10, 20], size: [50, 50] });
  });

  it("copies and pastes through the session clipboard", () => {
    const s = start(twoRects());
    s.selection.getState().select({ layers: ["b"], patches: ["tap"] });
    const fragment = copySelection(s)!;
    expect(s.clipboard).toBe(fragment);
    s.selection.getState().clear();
    const result = pasteFragment(s, fragment);
    expect(result.ok).toBe(true);
    expect(ids(s)).toEqual(["a", "b", "c", "b_2"]);
    expect(result.patches).toEqual(["tap_2"]);
    expect(main(s).patches.tap_2!.inputs.layer).toEqual({ layer: "a" });
    // The copy steps diagonally in 24 pt steps until it no longer covers the original.
    const size = estimatePatchSize(s.document.getState().doc, registry, main(s).patches.tap!);
    const step = Math.ceil(Math.min(size.width, size.height) / 24) * 24;
    expect(main(s).patches.tap_2!.ui).toEqual({ x: main(s).patches.tap!.ui.x + step, y: main(s).patches.tap!.ui.y + step });
  });

  it("pastes under ids retired in another component, but not in the target", () => {
    const s = start(
      build([
        { op: "addComponent", component: { id: "chip", name: "Chip", kind: "layerComponent" } },
        { op: "addLayer", component: "chip", layer: { id: "x", type: "rectangle", name: "X" } },
      ]),
    );
    s.selection.getState().setComponentPath(["main", "chip"]);
    s.selection.getState().select({ layers: ["x"] });
    const fragment = copySelection(s)!;
    deleteSelection(s);
    expect(s.document.getState().isRetiredId("chip", "x")).toBe(true);
    expect(pasteFragment(s, fragment).layers).toEqual(["x_2"]);
    s.selection.getState().setComponentPath(["main"]);
    expect(pasteFragment(s, fragment).layers).toEqual(["x"]);
  });

  it("pastes patches where they were when that spot is free", () => {
    const s = start(twoRects());
    s.selection.getState().select({ patches: ["tap"] });
    const fragment = copySelection(s)!;
    expect(freePasteOffset(s.document.getState().doc, "main", fragment, registry)).not.toEqual([0, 0]);
    s.document.getState().apply([{ op: "updatePatch", component: "main", id: "tap", ui: { x: 900, y: 900 } }], { label: "Move" });
    expect(freePasteOffset(s.document.getState().doc, "main", fragment, registry)).toEqual([0, 0]);
    const result = pasteFragment(s, fragment);
    expect(main(s).patches[result.patches[0]!]!.ui).toEqual({ x: fragment.patches.tap!.ui.x, y: fragment.patches.tap!.ui.y });
  });

  it("groups layers around their bounds and ungroups them back", () => {
    const s = start(twoRects());
    s.selection.getState().select({ layers: ["b", "a"] });
    const grouped = groupSelection(s);
    expect(grouped.ok).toBe(true);
    expect(grouped.groupId).toBe("group");
    expect(ids(s)).toEqual(["group", "c"]);
    expect(props(s, "group")).toEqual({ position: [10, 20], size: [110, 50] });
    expect(findLayer(main(s).layers, "group")!.layer.children!.map((l) => l.id)).toEqual(["a", "b"]);
    expect(props(s, "a").position).toEqual([0, 0]);
    expect(props(s, "b").position).toEqual([90, 20]);
    expect(s.selection.getState().layers).toEqual(["group"]);

    expect(ungroupSelection(s).ok).toBe(true);
    expect(ids(s)).toEqual(["a", "b", "c"]);
    expect(props(s, "a").position).toEqual([10, 20]);
    expect(props(s, "b").position).toEqual([100, 40]);
    expect(s.selection.getState().layers).toEqual(["a", "b"]);
  });

  it("refuses to group layers from different parents", () => {
    const s = start(
      build([
        { op: "addLayer", layer: { id: "g", type: "group", name: "G", children: [{ id: "inner", type: "rectangle", name: "Inner" }] } },
        { op: "addLayer", layer: { id: "outer", type: "rectangle", name: "Outer" } },
      ]),
    );
    s.selection.getState().select({ layers: ["inner", "outer"] });
    const result = groupSelection(s);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/different groups/);
  });

  it("creates a component, enters it, and exits back to the instance", () => {
    const s = start(twoRects());
    s.selection.getState().select({ layers: ["a"] });
    const result = createComponentFromSelection(s);
    expect(result.ok).toBe(true);
    const doc = s.document.getState().doc;
    expect(doc.components[result.componentId!]).toMatchObject({ name: "A", kind: "layerComponent" });
    expect(Object.keys(doc.components[result.componentId!]!.patches)).toEqual(["tap"]);
    expect(doc.components.main!.patches.tap).toBeUndefined();
    expect(s.selection.getState().layers).toEqual([result.instanceId]);
    expect(enterSelectedComponent(s)).toBe(true);
    expect(s.selection.getState().componentPath).toEqual(["main", result.componentId]);
    expect(exitComponent(s)).toBe(true);
    expect(s.selection.getState()).toMatchObject({ componentPath: ["main"], layers: [result.instanceId] });
  });

  it("selects all by focused panel", () => {
    const s = start(twoRects());
    s.selection.getState().setFocusedPanel("patchEditor");
    selectAll(s);
    expect(s.selection.getState()).toMatchObject({ layers: [], patches: ["tap"] });
    s.selection.getState().setFocusedPanel("layers");
    selectAll(s);
    expect(s.selection.getState()).toMatchObject({ layers: ["a", "b", "c"], patches: [] });
  });

  it("toggles visibility and lock, and arranges layers", () => {
    const s = start(twoRects());
    s.selection.getState().select({ layers: ["a"] });
    toggleLayerVisibility(s);
    expect(props(s, "a").enabled).toBe(false);
    toggleLayerVisibility(s);
    expect(props(s, "a").enabled).toBeUndefined();
    toggleLayerLock(s);
    expect(findLayer(main(s).layers, "a")!.layer.locked).toBe(true);

    arrangeLayers(s, "forward");
    expect(ids(s)).toEqual(["b", "a", "c"]);
    arrangeLayers(s, "front");
    expect(ids(s)).toEqual(["b", "c", "a"]);
    arrangeLayers(s, "back");
    expect(ids(s)).toEqual(["a", "b", "c"]);
    expect(arrangeLayers(s, "backward").ok).toBe(true);
    expect(ids(s)).toEqual(["a", "b", "c"]);
  });

  it("says when Z Position keeps Bring to Front or Send to Back from working", () => {
    const s = start(twoRects());
    s.document.getState().apply([{ op: "setInput", target: "@c.zPosition", value: 2 }], { label: "Raise C" });
    s.selection.getState().select({ layers: ["a"] });
    const front = arrangeLayers(s, "front");
    expect(ids(s)).toEqual(["b", "c", "a"]);
    const c = findLayer(main(s).layers, "c")!.layer.name;
    const a = findLayer(main(s).layers, "a")!.layer.name;
    expect(front.note).toEqual({
      message: `“${c}” still draws in front of “${a}”`,
      hint: `Its Z Position is 2, higher than “${a}”'s 0, and Z Position decides the order before the layer list does. Give “${a}” a Z Position above 2.`,
    });
    // Already at the front: nothing moves, and it still says why it isn't in front.
    expect(arrangeLayers(s, "front").note?.message).toBe(`“${c}” still draws in front of “${a}”`);
    s.selection.getState().select({ layers: ["c"] });
    const b = findLayer(main(s).layers, "b")!.layer.name;
    expect(arrangeLayers(s, "back").note?.message).toBe(`“${b}” still draws behind “${c}”`);
    s.selection.getState().select({ layers: ["b"] });
    expect(arrangeLayers(s, "forward").note).toBeUndefined();
  });
});
