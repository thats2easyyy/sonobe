import { applyOps, createEmptyDocument, createRegistry, findLayer, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { drawRect, insertOps, layoutDropTarget, moveOps, nudgeDelta, reorderOps, resizeOps, rotateOps, textOps, type FlowChild } from "./ops.ts";

const registry = createRegistry();

function docWithLayers(): SonobeDocument {
  const r = applyOps(
    createEmptyDocument(),
    [
      { op: "addLayer", layer: { id: "card", type: "rectangle", props: { position: [10, 10], size: [100, 50] } } },
      { op: "addLayer", layer: { id: "label", type: "text", props: { text: "Hi" } } },
      {
        op: "addLayer",
        layer: {
          id: "row",
          type: "group",
          props: { layout: "row", size: [300, 60] },
          children: [
            { id: "a", type: "rectangle" },
            { id: "b", type: "rectangle" },
            { id: "c", type: "rectangle" },
          ],
        },
      },
    ],
    { registry },
  );
  expect(r.ok).toBe(true);
  return r.doc;
}

const apply = (doc: SonobeDocument, ops: Parameters<typeof applyOps>[1]) => {
  const r = applyOps(doc, ops, { registry });
  expect(r.errors).toEqual([]);
  return r;
};

describe("op builders", () => {
  it("moves layers with rounded positions", () => {
    const ops = moveOps("main", [{ id: "card", position: [12.3456, 0.1 + 0.2] }]);
    expect(ops).toEqual([{ op: "updateLayer", component: "main", id: "card", props: { position: [12.35, 0.3] } }]);
    const r = apply(docWithLayers(), ops);
    expect(findLayer(r.doc.components.main!.layers, "card")!.layer.props.position).toEqual([12.35, 0.3]);
  });

  it("resizes and fixes auto sizing modes when asked", () => {
    const ops = resizeOps("main", [{ id: "label", size: [140, 30], position: [5, 5], fixWidth: true }]);
    expect(ops).toEqual([{ op: "updateLayer", component: "main", id: "label", props: { size: [140, 30], position: [5, 5], widthMode: "fixed" } }]);
    const layer = findLayer(apply(docWithLayers(), ops).doc.components.main!.layers, "label")!.layer;
    expect(layer.props).toMatchObject({ size: [140, 30], widthMode: "fixed" });
    expect(layer.props.heightMode).toBeUndefined();
  });

  it("rotates and edits text", () => {
    const r = apply(docWithLayers(), [...rotateOps("main", "card", 33.333333), ...textOps("main", "label", "Hello")]);
    const layers = r.doc.components.main!.layers;
    expect(findLayer(layers, "card")!.layer.props.rotation).toBe(33.33);
    expect(findLayer(layers, "label")!.layer.props.text).toBe("Hello");
  });

  it("reorders a layout child", () => {
    const r = apply(docWithLayers(), reorderOps("main", "a", "row", 2));
    expect(findLayer(r.doc.components.main!.layers, "row")!.layer.children!.map((l) => l.id)).toEqual(["b", "c", "a"]);
  });

  it("inserts shapes by drag and by click", () => {
    const dragged = insertOps("main", "rectangle", { x: 20.004, y: 30, width: 80, height: 40 });
    expect(dragged).toEqual([{ op: "addLayer", component: "main", parent: null, layer: { ref: "inserted", type: "rectangle", props: { position: [20, 30], size: [80, 40] } } }]);
    const clicked = insertOps("main", "oval", { x: 5, y: 5, width: 0, height: 0 }, { parent: "row", index: 1, ref: "dot" });
    expect(clicked[0]).toMatchObject({ parent: "row", index: 1, layer: { ref: "dot", type: "oval", props: { position: [5, 5], size: [100, 100] } } });
    const r = apply(docWithLayers(), [...dragged, ...clicked]);
    expect(r.idMap.inserted).toBe("rectangle");
    expect(findLayer(r.doc.components.main!.layers, r.idMap.dot!)!.parent!.id).toBe("row");
  });

  it("inserts text with auto width on click and fixed width on drag", () => {
    const click = insertOps("main", "text", { x: 1, y: 2, width: 0, height: 0 });
    expect(click[0]).toMatchObject({ layer: { type: "text", props: { position: [1, 2], text: "Text" } } });
    expect((click[0] as { layer: { props: Record<string, unknown> } }).layer.props.widthMode).toBeUndefined();
    const drag = insertOps("main", "text", { x: 1, y: 2, width: 120, height: 24 });
    expect(drag[0]).toMatchObject({ layer: { props: { size: [120, 24], widthMode: "fixed" } } });
    apply(docWithLayers(), [...click, ...drag.map((op) => ({ ...op, layer: { ...(op as { layer: object }).layer, ref: "t2" } }) as typeof op)]);
  });
});

describe("drawRect", () => {
  it("draws in any direction, as a square with ⇧, and from the center with ⌥", () => {
    expect(drawRect([50, 50], [10, 80])).toEqual({ x: 10, y: 50, width: 40, height: 30 });
    expect(drawRect([50, 50], [10, 80], { square: true })).toEqual({ x: 10, y: 50, width: 40, height: 40 });
    expect(drawRect([50, 50], [60, 70], { fromCenter: true })).toEqual({ x: 40, y: 30, width: 20, height: 40 });
  });
});

describe("nudgeDelta", () => {
  it("moves 1 pt, or 10 with ⇧", () => {
    expect(nudgeDelta("ArrowLeft", false)).toEqual([-1, 0]);
    expect(nudgeDelta("ArrowDown", true)).toEqual([0, 10]);
  });
});

describe("layoutDropTarget", () => {
  const row: FlowChild[] = [
    { id: "a", rect: { x: 0, y: 0, width: 50, height: 50 }, inFlow: true },
    { id: "bg", rect: { x: 0, y: 0, width: 300, height: 50 }, inFlow: false },
    { id: "b", rect: { x: 60, y: 0, width: 50, height: 50 }, inFlow: true },
    { id: "c", rect: { x: 120, y: 0, width: 50, height: 50 }, inFlow: true },
  ];

  it("finds the index in a row by comparing centers", () => {
    // Drag "a" past b's center: it lands before c. Among [bg, b, c], c is index 2.
    expect(layoutDropTarget(row, "a", [100, 25], "row")).toEqual({ index: 2, flowIndex: 1, line: [[120, 0], [120, 50]] });
    // Past everything: after c.
    expect(layoutDropTarget(row, "a", [400, 25], "row").index).toBe(3);
    // Before b: index of b among [bg, b, c].
    expect(layoutDropTarget(row, "c", [10, 25], "row").index).toBe(0);
  });

  it("uses y for columns and row-major order for grids", () => {
    const column: FlowChild[] = [
      { id: "a", rect: { x: 0, y: 0, width: 50, height: 50 }, inFlow: true },
      { id: "b", rect: { x: 0, y: 60, width: 50, height: 50 }, inFlow: true },
    ];
    expect(layoutDropTarget(column, "a", [25, 100], "column")).toEqual({ index: 1, flowIndex: 1, line: [[0, 110], [50, 110]] });
    const grid: FlowChild[] = [
      { id: "a", rect: { x: 0, y: 0, width: 50, height: 50 }, inFlow: true },
      { id: "b", rect: { x: 60, y: 0, width: 50, height: 50 }, inFlow: true },
      { id: "c", rect: { x: 0, y: 60, width: 50, height: 50 }, inFlow: true },
      { id: "d", rect: { x: 60, y: 60, width: 50, height: 50 }, inFlow: true },
    ];
    // Second row, right of c's center: before d → index of d among [b, c, d] = 2.
    expect(layoutDropTarget(grid, "a", [40, 80], "grid").index).toBe(2);
    // First row, past a's center but left of b's: before b.
    expect(layoutDropTarget(grid, "d", [40, 20], "grid").index).toBe(1);
    expect(layoutDropTarget(grid, "d", [10, 20], "grid").index).toBe(0);
  });
});
