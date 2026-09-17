import { applyOps, createEmptyDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it, vi } from "vitest";
import { getRegistry } from "./registry.ts";
import { createSelectionStore, currentComponentId, hasSelection, selectBreadcrumbs } from "./selection.ts";

const registry = getRegistry();

function build(ops: Op[], doc: SonobeDocument = createEmptyDocument()): SonobeDocument {
  const result = applyOps(doc, ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

const baseDoc = () =>
  build([
    { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } },
    { op: "addLayer", layer: { id: "title", type: "text", name: "Title" } },
    { op: "addPatch", patch: { id: "tap", type: "interaction", inputs: { layer: { layer: "card" } } } },
    { op: "addComment", comment: { id: "note", text: "Hi", rect: [0, 0, 100, 100] } },
    { op: "addComponent", component: { id: "button", name: "Button", kind: "layerComponent" } },
  ]);

describe("selection store", () => {
  it("combines selections by mode", () => {
    const s = createSelectionStore();
    s.getState().select({ layers: ["a", "b"] });
    s.getState().select({ layers: ["c"] }, "add");
    expect(s.getState().layers).toEqual(["a", "b", "c"]);
    s.getState().select({ layers: ["b", "d"] }, "toggle");
    expect(s.getState().layers).toEqual(["a", "c", "d"]);
    s.getState().select({ layers: ["a"] }, "remove");
    expect(s.getState().layers).toEqual(["c", "d"]);
    s.getState().selectItem("patch", "tap", "add");
    expect(s.getState()).toMatchObject({ layers: ["c", "d"], patches: ["tap"] });
    s.getState().select({ patches: ["x"] });
    expect(s.getState()).toMatchObject({ layers: [], patches: ["x"], comments: [] });
    s.getState().clear();
    expect(hasSelection(s.getState())).toBe(false);
  });

  it("prunes ids that no longer exist", () => {
    const doc = baseDoc();
    const s = createSelectionStore();
    s.getState().select({ layers: ["card", "title"], patches: ["tap"], comments: ["note"] });
    s.getState().setHovered({ kind: "patch", id: "tap", component: "main", source: "patchEditor" });
    const next = build([{ op: "removeLayer", id: "title" }, { op: "removePatch", id: "tap" }], doc);
    s.getState().prune(next);
    expect(s.getState()).toMatchObject({ layers: ["card"], patches: [], comments: ["note"], hovered: null });
  });

  it("does not notify when pruning changes nothing", () => {
    const doc = baseDoc();
    const s = createSelectionStore();
    s.getState().select({ layers: ["card"] });
    const listener = vi.fn();
    s.subscribe(listener);
    s.getState().prune(doc);
    expect(listener).not.toHaveBeenCalled();
  });

  it("enters and exits components with breadcrumbs", () => {
    const doc = baseDoc();
    const s = createSelectionStore();
    s.getState().select({ layers: ["card"] });
    s.getState().enterComponent("button");
    expect(currentComponentId(s.getState())).toBe("button");
    expect(s.getState().layers).toEqual([]);
    expect(selectBreadcrumbs(s.getState(), doc)).toEqual([
      { id: "main", name: "Main", kind: "prototype", path: ["main"] },
      { id: "button", name: "Button", kind: "layerComponent", path: ["main", "button"] },
    ]);
    s.getState().enterComponent("main");
    expect(s.getState().componentPath).toEqual(["main"]);
    s.getState().enterComponent("button");
    s.getState().exitComponent({ layers: ["card"] });
    expect(s.getState()).toMatchObject({ componentPath: ["main"], layers: ["card"] });
  });

  it("leaves a component that was removed", () => {
    const doc = baseDoc();
    const s = createSelectionStore();
    s.getState().enterComponent("button");
    s.getState().select({ layers: ["x"] });
    s.getState().setPatchViewport("button", { x: 1, y: 2, zoom: 1.5 });
    s.getState().setPatchViewport("main", { x: 0, y: 0, zoom: 1 });
    s.getState().prune(build([{ op: "removeComponent", id: "button" }], doc));
    expect(s.getState().componentPath).toEqual(["main"]);
    expect(s.getState().layers).toEqual([]);
    expect(Object.keys(s.getState().patchViewports)).toEqual(["main"]);
  });

  it("tracks focus, viewports, and reveal requests", () => {
    const s = createSelectionStore();
    s.getState().setFocusedPanel("patchEditor");
    s.getState().setCanvasViewport("main", { x: 10, y: 20, zoom: 2 });
    s.getState().requestReveal("main", ["card"]);
    const first = s.getState().reveal!.nonce;
    s.getState().requestReveal("main", ["card"]);
    expect(s.getState()).toMatchObject({ focusedPanel: "patchEditor", canvasViewports: { main: { x: 10, y: 20, zoom: 2 } }, reveal: { component: "main", ids: ["card"] } });
    expect(s.getState().reveal!.nonce).toBe(first + 1);
  });
});
