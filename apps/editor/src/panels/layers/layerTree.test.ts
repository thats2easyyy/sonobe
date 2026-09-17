import { applyOps, createEmptyDocument, findLayer, type LayerNode, type Op, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { getRegistry } from "../../state/registry.ts";
import { displayTree, filterLayerTree, isFiltering, parentLayerIds, planInsertLayer, planLayerMove, relatedPatchIds, treeIds } from "./layerTree.ts";

const registry = getRegistry();

function apply(doc: SonobeDocument, ops: Op[]): SonobeDocument {
  const result = applyOps(doc, ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

const ids = (layers: readonly LayerNode[]) => layers.map((l) => l.id);

const base = () =>
  apply(createEmptyDocument(), [
    { op: "addLayer", layer: { id: "a", type: "rectangle", name: "A" } },
    { op: "addLayer", layer: { id: "b", type: "rectangle", name: "B" } },
    { op: "addLayer", layer: { id: "group", type: "group", name: "Group", children: [{ id: "g1", type: "oval", name: "Inner One" }, { id: "g2", type: "text", name: "Label" }] } },
    { op: "addLayer", layer: { id: "c", type: "text", name: "Title" } },
  ]);

describe("displayTree", () => {
  it("lists front-most layers first at every level and keeps node identity", () => {
    const doc = base();
    const display = displayTree(doc.components.main!.layers);
    expect(ids(display)).toEqual(["c", "group", "b", "a"]);
    expect(ids(display[1]!.children!)).toEqual(["g2", "g1"]);
    expect(displayTree(doc.components.main!.layers)[1]).toBe(display[1]);
    expect(parentLayerIds(display)).toEqual(["group"]);
    expect([...treeIds(display)].sort()).toEqual(["a", "b", "c", "g1", "g2", "group"]);
  });
});

describe("filterLayerTree", () => {
  it("keeps matching layers and their ancestors", () => {
    const display = displayTree(base().components.main!.layers);
    const byName = filterLayerTree(display, { query: "label", types: new Set() });
    expect(ids(byName)).toEqual(["group"]);
    expect(ids(byName[0]!.children!)).toEqual(["g2"]);
    const byType = filterLayerTree(display, { query: "", types: new Set(["rectangle"]) });
    expect(ids(byType)).toEqual(["b", "a"]);
    const byTypeName = filterLayerTree(display, { query: "oval", types: new Set() }, (type) => registry.layers.get(type)?.name ?? type);
    expect(ids(byTypeName[0]!.children!)).toEqual(["g1"]);
    expect(isFiltering({ query: " ", types: new Set() })).toBe(false);
  });
});

describe("planLayerMove", () => {
  it("moves a back layer to the front with one op", () => {
    const doc = base();
    const ops = planLayerMove(doc.components.main!, ["a"], { parentId: null, index: 0 });
    expect(ops).toHaveLength(1);
    expect(ids(apply(doc, ops).components.main!.layers)).toEqual(["b", "group", "c", "a"]);
  });

  it("reparents several layers into a group, keeping their order", () => {
    const doc = base();
    const ops = planLayerMove(doc.components.main!, ["c", "b"], { parentId: "group", index: 0 });
    const next = apply(doc, ops).components.main!;
    expect(ids(next.layers)).toEqual(["a", "group"]);
    expect(ids(findLayer(next.layers, "group")!.layer.children!)).toEqual(["g1", "g2", "b", "c"]);
  });

  it("moves a child out to the root between two layers", () => {
    const doc = base();
    // Display rows: c, group, (g2, g1), b, a. Drop g2 before b: root display index 2.
    const ops = planLayerMove(doc.components.main!, ["g2"], { parentId: null, index: 2 });
    const next = apply(doc, ops).components.main!;
    expect(ids(next.layers)).toEqual(["a", "b", "g2", "group", "c"]);
    expect(ids(findLayer(next.layers, "group")!.layer.children!)).toEqual(["g1"]);
  });

  it("emits nothing for a drop in place or into the dragged layer itself", () => {
    const doc = base();
    expect(planLayerMove(doc.components.main!, ["b"], { parentId: null, index: 2 })).toEqual([]);
    expect(planLayerMove(doc.components.main!, ["group"], { parentId: "group", index: 0 })).toEqual([]);
  });
});

describe("planInsertLayer", () => {
  it("inserts in front of the anchor, centered in the artboard", () => {
    const doc = base();
    const plan = planInsertLayer(doc, "main", registry, "rectangle", { anchor: "b" })!;
    const result = applyOps(doc, [plan.op], { registry });
    expect(result.ok).toBe(true);
    const newId = result.idMap[plan.ref]!;
    const main = result.doc.components.main!;
    expect(ids(main.layers)).toEqual(["a", "b", newId, "group", "c"]);
    const [w, h] = main.size!;
    expect(findLayer(main.layers, newId)!.layer.props.position).toEqual([Math.round((w - 100) / 2), Math.round((h - 100) / 2)]);
  });

  it("sizes a component instance from its component", () => {
    const doc = apply(base(), [{ op: "addComponent", component: { id: "button", name: "Button", kind: "layerComponent", size: [120, 44] } }]);
    const plan = planInsertLayer(doc, "main", registry, "componentInstance", { component: "button" })!;
    expect(plan.name).toBe("Button");
    const result = applyOps(doc, [plan.op], { registry });
    expect(result.ok).toBe(true);
    const layer = findLayer(result.doc.components.main!.layers, result.idMap[plan.ref]!)!.layer;
    expect(layer.component).toBe("button");
    expect(layer.props.size).toEqual([120, 44]);
    expect(planInsertLayer(doc, "main", registry, "nope")).toBeUndefined();
  });
});

describe("relatedPatchIds", () => {
  it("finds patches that watch or drive a layer", () => {
    const doc = apply(base(), [
      { op: "addPatch", patch: { id: "grow", type: "transition", typeParam: "number", ui: { x: 400, y: 20 } } },
      { op: "addPatch", patch: { id: "tap", type: "interaction", inputs: { layer: { layer: "a" } }, ui: { x: 40, y: 60 } } },
      { op: "addPatch", patch: { id: "other", type: "interaction", inputs: { layer: { layer: "b" } }, ui: { x: 40, y: 300 } } },
      { op: "connect", from: "grow.output", to: "@a.scale" },
    ]);
    expect(relatedPatchIds(doc.components.main!, "a")).toEqual(["grow", "tap"]);
    expect(relatedPatchIds(doc.components.main!, "c")).toEqual([]);
  });
});
