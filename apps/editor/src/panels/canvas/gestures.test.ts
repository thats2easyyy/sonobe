import { applyOps, findLayer, type Op, type SonobeDocument } from "@sonobe/core";
import { buildDoc, createMockRegistry, createTestRuntime } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import {
  beginMove,
  beginReorder,
  beginResize,
  beginRotate,
  insertGesture,
  insertParentAt,
  moveGesture,
  nudgeGesture,
  nudgeReorder,
  nudgeStarts,
  reorderGesture,
  resizeGesture,
  rotateGesture,
  type MoveSnapshot,
} from "./gestures.ts";
import { buildCanvasIndex, type CanvasIndex } from "./sceneIndex.ts";

const registry = createMockRegistry();
const artboard = { x: 0, y: 0, width: 390, height: 844 };
const noSnap = { snap: false, threshold: 0 };

function indexFor(doc: SonobeDocument): CanvasIndex {
  const rt = createTestRuntime(doc);
  const scene = rt.step();
  rt.dispose();
  return buildCanvasIndex(doc.components[doc.project.root], scene);
}

function applied(doc: SonobeDocument, ops: Op[]) {
  const r = applyOps(doc, ops, { registry });
  expect(r.errors).toEqual([]);
  return r;
}

const prop = (doc: SonobeDocument, id: string, key: string) => findLayer(doc.components.main!.layers, id)!.layer.props[key];

const doc = () =>
  buildDoc({
    layers: [
      { id: "card", type: "rectangle", props: { position: [40, 40], size: [100, 60] } },
      { id: "centered", type: "rectangle", props: { position: [200, 200], size: [80, 40], anchor: [0.5, 0.5] } },
      {
        id: "zoomed",
        type: "group",
        props: { position: [0, 400], size: [200, 200], scale: 2, pivot: [0, 0], color: "#FFFFFFFF" },
        children: [{ id: "inner", type: "rectangle", props: { position: [10, 10], size: [20, 20] } }],
      },
      { id: "label", type: "text", props: { position: [20, 700], text: "Hello" } },
      { id: "follower", type: "rectangle", props: { position: { link: "@card.position" }, size: [10, 10] } },
    ],
  });

describe("move", () => {
  it("moves layers by whole points and respects anchors", () => {
    const d = doc();
    const index = indexFor(d);
    const s = beginMove(index, "main", ["card", "centered"], artboard) as MoveSnapshot;
    expect(s.bounds).toEqual({ x: 40, y: 40, width: 200, height: 180 });
    const r = moveGesture(s, [50, 50], [63.4, 57.6], noSnap);
    expect(r.ops).toEqual([
      { op: "updateLayer", component: "main", id: "card", props: { position: [53, 48] } },
      { op: "updateLayer", component: "main", id: "centered", props: { position: [213, 208] } },
    ]);
    const out = applied(d, r.ops).doc;
    expect(prop(out, "centered", "position")).toEqual([213, 208]);
  });

  it("converts the drag into a scaled parent's space", () => {
    const index = indexFor(doc());
    const s = beginMove(index, "main", ["inner"], artboard) as MoveSnapshot;
    expect(s.bounds).toEqual({ x: 20, y: 420, width: 40, height: 40 });
    const r = moveGesture(s, [30, 430], [50, 450], noSnap);
    expect(r.ops[0]).toMatchObject({ id: "inner", props: { position: [20, 20] } });
  });

  it("snaps to siblings and the artboard with guides and gap measurements", () => {
    const index = indexFor(doc());
    const s = beginMove(index, "main", ["card"], artboard) as MoveSnapshot;
    // Center x 90 → 195 would be 197; the artboard center (195) is within 4.
    const r = moveGesture(s, [0, 0], [107, 0], { snap: true, threshold: 4 });
    expect(r.ops[0]).toMatchObject({ props: { position: [145, 40] } });
    expect(r.guides).toContainEqual(expect.objectContaining({ axis: "x", at: 195 }));
    expect(r.measurements.length).toBeGreaterThan(0);
  });

  it("locks to the dominant axis with ⇧", () => {
    const index = indexFor(doc());
    const s = beginMove(index, "main", ["card"], artboard) as MoveSnapshot;
    const r = moveGesture(s, [0, 0], [30, 8], { ...noSnap, axisLock: true });
    expect(r.ops[0]).toMatchObject({ props: { position: [70, 40] } });
  });

  it("leaves out layers whose Position is linked", () => {
    const index = indexFor(doc());
    const s = beginMove(index, "main", ["follower"], artboard);
    expect(s.layers).toEqual([]);
    expect(s.blocked).toEqual(["follower"]);
  });
});

describe("resize", () => {
  it("resizes one layer from a corner", () => {
    const d = doc();
    const s = beginResize(indexFor(d), "main", ["card"], "nw", artboard)!;
    const r = resizeGesture(s, [40, 40], [30, 20], noSnap);
    expect(r.ops).toEqual([{ op: "updateLayer", component: "main", id: "card", props: { size: [110, 80], position: [30, 20] } }]);
    expect(r.bounds).toEqual({ x: 30, y: 20, width: 110, height: 80 });
    applied(d, r.ops);
  });

  it("keeps a centered anchor's opposite edge fixed", () => {
    const s = beginResize(indexFor(doc()), "main", ["centered"], "e", artboard)!;
    const r = resizeGesture(s, [240, 200], [260, 200], noSnap);
    expect(r.ops[0]).toMatchObject({ props: { size: [100, 40], position: [210, 200] } });
  });

  it("switches auto sizing to fixed when a text layer is resized", () => {
    const d = doc();
    const index = indexFor(d);
    const node = index.entry("label")!.node!;
    const s = beginResize(index, "main", ["label"], "e", artboard)!;
    const r = resizeGesture(s, [20 + node.width, 710], [20 + node.width + 50, 710], noSnap);
    expect(r.ops[0]).toMatchObject({ props: { widthMode: "fixed" } });
    expect((r.ops[0] as { props: Record<string, unknown> }).props.heightMode).toBeUndefined();
    expect(prop(applied(d, r.ops).doc, "label", "widthMode")).toBe("fixed");
  });

  it("scales a multi-selection proportionally within its bounds", () => {
    const s = beginResize(indexFor(doc()), "main", ["card", "centered"], "se", artboard)!;
    expect(s.bounds).toEqual({ x: 40, y: 40, width: 200, height: 180 });
    // Double the bounds from the top-left.
    const r = resizeGesture(s, [240, 220], [440, 400], noSnap);
    expect(r.ops).toEqual([
      { op: "updateLayer", component: "main", id: "card", props: { size: [200, 120], position: [40, 40] } },
      { op: "updateLayer", component: "main", id: "centered", props: { size: [160, 80], position: [360, 360] } },
    ]);
  });

  it("snaps the moving edge", () => {
    const s = beginResize(indexFor(doc()), "main", ["card"], "e", artboard)!;
    // Right edge 140 → 238 is within 3 of centered's left edge (240).
    const r = resizeGesture(s, [140, 70], [238, 70], { snap: true, threshold: 3 });
    expect(r.ops[0]).toMatchObject({ props: { size: [200, 60] } });
    expect(r.guides).toContainEqual(expect.objectContaining({ axis: "x", at: 240 }));
  });

  it("keeps proportions with ⇧ and resizes from the center with ⌥", () => {
    const s = beginResize(indexFor(doc()), "main", ["card"], "se", artboard)!;
    const r = resizeGesture(s, [140, 100], [240, 110], { ...noSnap, proportional: true, fromCenter: true });
    // ⌥ doubles the pointer delta; ⇧ follows the dominant axis (x: 100 → 200 wider, ×3).
    expect(r.ops[0]).toMatchObject({ props: { size: [300, 180], position: [-60, -20] } });
  });
});

describe("rotate", () => {
  it("rotates around the pivot", () => {
    const index = indexFor(doc());
    const s = beginRotate(index, "main", "card")!;
    expect(s.center).toEqual([90, 70]);
    expect(rotateGesture(s, [90, 20], [140, 70]).ops).toEqual([{ op: "updateLayer", component: "main", id: "card", props: { rotation: 90 } }]);
    expect(rotateGesture(s, [90, 20], [100, 25], { snap: true }).rotation).toBe(15);
  });
});

describe("layout children", () => {
  const rowDoc = () =>
    buildDoc({
      layers: [
        {
          id: "row",
          type: "group",
          props: { layout: "row", spacing: 10, size: [300, 50] },
          children: [
            { id: "a", type: "rectangle", props: { size: [50, 50] } },
            { id: "pinned", type: "rectangle", props: { positioning: "absolute", position: [250, 0], size: [10, 10] } },
            { id: "b", type: "rectangle", props: { size: [50, 50] } },
            { id: "c", type: "rectangle", props: { size: [50, 50] } },
          ],
        },
      ],
    });

  it("reorders instead of moving", () => {
    const d = rowDoc();
    const index = indexFor(d);
    expect(beginMove(index, "main", ["a"], artboard).layers).toHaveLength(1);
    const s = beginReorder(index, "main", "a")!;
    expect(s.layout).toBe("row");
    const r = reorderGesture(s, [25, 25], [100, 25]);
    // Past b's center: before c, which is index 2 among [pinned, b, c].
    expect(r.ops).toEqual([{ op: "moveLayer", component: "main", id: "a", parent: "row", index: 2 }]);
    expect(r.ghost.x).toBe(75);
    const out = applied(d, r.ops).doc;
    expect(findLayer(out.components.main!.layers, "row")!.layer.children!.map((l) => l.id)).toEqual(["pinned", "b", "a", "c"]);
    // Dropping where it started makes no op.
    expect(reorderGesture(s, [25, 25], [20, 25]).ops).toEqual([]);
  });

  it("nudges layout children along their siblings, skipping absolute ones", () => {
    const d = rowDoc();
    const index = indexFor(d);
    expect(nudgeReorder(index, "main", "a", 1)).toEqual([{ op: "moveLayer", component: "main", id: "a", parent: "row", index: 2 }]);
    expect(nudgeReorder(index, "main", "a", -1)).toEqual([]);
    expect(nudgeReorder(index, "main", "c", -1)).toEqual([{ op: "moveLayer", component: "main", id: "c", parent: "row", index: 2 }]);
    expect(nudgeReorder(index, "main", "pinned", 1)).toEqual([]);
  });

  it("nudges absolute layers by position", () => {
    const index = indexFor(rowDoc());
    const { starts } = nudgeStarts(index, ["a", "pinned"]);
    expect([...starts.keys()]).toEqual(["pinned"]);
    expect(nudgeGesture("main", starts, [-10, 1])).toEqual([{ op: "updateLayer", component: "main", id: "pinned", props: { position: [240, 1] } }]);
  });
});

describe("insert", () => {
  it("draws at the root in whole points", () => {
    const d = doc();
    const index = indexFor(d);
    const r = insertGesture(index, "main", "rectangle", [200.4, 300.2], [260.6, 340.9]);
    expect(r.parentId).toBeNull();
    expect(r.ops).toEqual([{ op: "addLayer", component: "main", parent: null, layer: { ref: "inserted", type: "rectangle", props: { position: [200, 300], size: [61, 41] } } }]);
    const out = applied(d, r.ops);
    expect(prop(out.doc, out.idMap.inserted!, "size")).toEqual([61, 41]);
  });

  it("draws into the group under the pointer, in its local space", () => {
    const d = doc();
    const index = indexFor(d);
    expect(insertParentAt(index, [100, 500])).toBe("zoomed");
    const r = insertGesture(index, "main", "oval", [100, 500], [140, 520], { square: true });
    expect(r.rect).toEqual({ x: 100, y: 500, width: 40, height: 40 });
    expect(r.ops[0]).toMatchObject({ parent: "zoomed", layer: { type: "oval", props: { position: [50, 50], size: [20, 20] } } });
    applied(d, r.ops);
  });

  it("clicks text in with auto width", () => {
    const r = insertGesture(indexFor(doc()), "main", "text", [300, 60], [300, 60], { click: true });
    expect(r.ops[0]).toMatchObject({ parent: null, layer: { type: "text", props: { position: [300, 60], text: "Text" } } });
  });
});
