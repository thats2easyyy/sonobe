import { describe, expect, it } from "vitest";
import { PointerTracker } from "../gestures/pointer.ts";
import { computeLayout, type LayoutNode, type LayoutResult } from "../layout/computeLayout.ts";
import { compose, multiply, planeInverse } from "../math/matrix.ts";
import type { InputEvent, SceneNode } from "../types.ts";
import { hitTest } from "./hitTest.ts";

/** The conventions the runtime relies on: layout frames → compose → world transforms → hit test → gestures. */
function toScene(
  node: LayoutNode,
  layout: Map<string, LayoutResult>,
  parent: SceneNode | null,
): SceneNode {
  const f = layout.get(node.key)!;
  const scale = typeof node.props.scale === "number" ? node.props.scale : 1;
  const rotation = typeof node.props.rotation === "number" ? node.props.rotation : 0;
  const transform = compose({
    position: [f.x, f.y],
    size: [f.width, f.height],
    scale,
    rotationZ: rotation,
  });
  const scene: SceneNode = {
    key: node.key,
    layerId: node.key,
    type: node.type,
    parentKey: parent?.key ?? null,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    transform,
    worldTransform: parent ? multiply(parent.worldTransform, transform) : transform,
    opacity: 1,
    visible: true,
    clip: false,
    props: node.props,
    children: [],
  };
  scene.children = (node.children ?? []).map((c) => toScene(c, layout, scene));
  return scene;
}

function find(node: SceneNode, key: string): SceneNode | undefined {
  if (node.key === key) return node;
  for (const c of node.children) {
    const hit = find(c, key);
    if (hit) return hit;
  }
  return undefined;
}

describe("layout → scene → hit test → gestures", () => {
  const row = (i: number): LayoutNode => ({
    key: `row${i}`,
    type: "group",
    props: { size: [0, 80], widthMode: "grow" },
    children: [
      {
        key: `like${i}`,
        type: "rectangle",
        props: { position: [280, 20], size: [60, 40], scale: i === 2 ? 1.5 : 1 },
      },
    ],
  });
  const root: LayoutNode = {
    key: "root",
    type: "group",
    props: {},
    children: [
      {
        key: "list",
        type: "group",
        props: { position: [0, 100], size: [390, 400], layout: "column", padding: 16, spacing: 12 },
        children: [row(0), row(1), row(2)],
      },
    ],
  };
  const layout = computeLayout(root, undefined, [390, 844]);
  const scene = toScene(root, layout, null);

  it("hits the laid-out button and bubbles through its row, list, and root", () => {
    // row1 top = list.y 100 + padding 16 + (80 + 12); like1 = row origin + (280, 20)
    expect(hitTest([scene], 16 + 290, 100 + 16 + 92 + 30).map((n) => n.key)).toEqual([
      "like1",
      "row1",
      "list",
      "root",
    ]);
    expect(hitTest([scene], 10, 10).map((n) => n.key)).toEqual(["root"]);
  });

  it("scaled layers are hit where they are drawn", () => {
    // like2 is scaled 1.5× about its center: 60×40 grows to 90×60 on screen.
    const top = 100 + 16 + 2 * 92;
    const leftEdge = 16 + 280;
    expect(hitTest([scene], leftEdge - 10, top + 40).map((n) => n.key)[0]).toBe("like2");
    expect(hitTest([scene], leftEdge - 20, top + 40).map((n) => n.key)[0]).toBe("row2");
  });

  it("a tap on the button reports local coordinates through planeInverse", () => {
    const tracker = new PointerTracker();
    const hit = (x: number, y: number) => hitTest([scene], x, y);
    const like0 = find(scene, "like0")!;
    const at: [number, number] = [16 + 280 + 14, 100 + 16 + 20 + 12];
    const press: InputEvent = { kind: "pointer", phase: "down", pointerId: 1, x: at[0], y: at[1] };
    const release: InputEvent = { kind: "pointer", phase: "up", pointerId: 1, x: at[0], y: at[1] };
    tracker.update([press], hit, 1 / 60);
    const began = tracker.snapshot("like0", planeInverse(like0.worldTransform));
    expect(began.began).toBe(true);
    expect(began.localPosition[0]).toBeCloseTo(14, 9);
    expect(began.localPosition[1]).toBeCloseTo(12, 9);
    tracker.endFrame();
    tracker.update([release], hit, 1 / 60);
    expect(tracker.snapshot("like0").tapped).toBe(true);
    expect(tracker.snapshot("row0").tapped).toBe(true);
    expect(tracker.snapshot("like1").tapped).toBe(false);
  });
});
