import { describe, expect, it } from "vitest";
import { compose, multiply } from "../math/matrix.ts";
import type { SceneNode } from "../types.ts";
import { containsPoint, hitTest, isInteractive, toLocalPoint } from "./hitTest.ts";

interface Spec {
  key: string;
  type?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  rotationY?: number;
  scale?: number;
  pivot?: [number, number];
  opacity?: number;
  visible?: boolean;
  clip?: boolean;
  props?: Record<string, unknown>;
  children?: Spec[];
}

function build(spec: Spec, parent: SceneNode | null = null): SceneNode {
  const transform = compose({
    position: [spec.x, spec.y],
    size: [spec.w, spec.h],
    pivot: spec.pivot,
    scale: spec.scale ?? 1,
    rotationZ: spec.rotation ?? 0,
    rotationY: spec.rotationY ?? 0,
  });
  const node: SceneNode = {
    key: spec.key,
    layerId: spec.key.split("#")[0]!,
    type: spec.type ?? "rectangle",
    parentKey: parent?.key ?? null,
    x: spec.x,
    y: spec.y,
    width: spec.w,
    height: spec.h,
    transform,
    worldTransform: parent ? multiply(parent.worldTransform, transform) : transform,
    opacity: spec.opacity ?? 1,
    visible: spec.visible ?? true,
    clip: spec.clip ?? false,
    props: spec.props ?? {},
    children: [],
  };
  node.children = (spec.children ?? []).map((c) => build(c, node));
  return node;
}

const keys = (chain: SceneNode[]) => chain.map((n) => n.key);

describe("hitTest", () => {
  const scene = () => [
    build({
      key: "screen",
      type: "group",
      x: 0,
      y: 0,
      w: 400,
      h: 800,
      children: [
        {
          key: "card",
          x: 50,
          y: 100,
          w: 200,
          h: 100,
          type: "group",
          children: [{ key: "icon", x: 10, y: 10, w: 20, h: 20 }],
        },
      ],
    }),
  ];

  it("returns the front-most target first, then ancestors", () => {
    const roots = scene();
    expect(keys(hitTest(roots, 65, 115))).toEqual(["icon", "card", "screen"]);
    expect(keys(hitTest(roots, 150, 150))).toEqual(["card", "screen"]);
    expect(keys(hitTest(roots, 5, 5))).toEqual(["screen"]);
    expect(hitTest(roots, 500, 5)).toEqual([]);
  });

  it("later siblings and higher zPosition are in front", () => {
    const roots = [
      build({ key: "a", x: 0, y: 0, w: 100, h: 100 }),
      build({ key: "b", x: 50, y: 50, w: 100, h: 100 }),
    ];
    expect(keys(hitTest(roots, 75, 75))).toEqual(["b"]);
    const lifted = [
      build({ key: "a", x: 0, y: 0, w: 100, h: 100, props: { zPosition: 5 } }),
      build({ key: "b", x: 50, y: 50, w: 100, h: 100 }),
    ];
    expect(keys(hitTest(lifted, 75, 75))).toEqual(["a"]);
  });

  it("hits the loop copy that draws in front", () => {
    // zPosition = 2 − index, as in a deck where copy 0 is the top card.
    const copies = [0, 1, 2].map((i) =>
      build({ key: `card#${i}`, x: 0, y: 0, w: 100, h: 100, props: { zPosition: 2 - i } }),
    );
    expect(keys(hitTest(copies, 50, 50))).toEqual(["card#0"]);
    const hidden = copies.map((c, i) => (i === 0 ? { ...c, visible: false } : c));
    expect(keys(hitTest(hidden, 50, 50))).toEqual(["card#1"]);
  });

  it("reorders only among siblings: a lifted child stays inside its group", () => {
    const roots = [
      build({
        key: "group",
        type: "group",
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        children: [{ key: "deep", x: 0, y: 0, w: 100, h: 100, props: { zPosition: 100 } }],
      }),
      build({ key: "later", x: 0, y: 0, w: 100, h: 100 }),
    ];
    expect(keys(hitTest(roots, 50, 50))).toEqual(["later"]);
  });

  it("respects rotation about the pivot", () => {
    const roots = [build({ key: "card", x: 100, y: 100, w: 200, h: 100, rotation: 45 })];
    expect(hitTest(roots, 110, 195)).toEqual([]);
    const along = [200 + 80 * Math.SQRT1_2, 150 + 80 * Math.SQRT1_2];
    expect(keys(hitTest(roots, along[0]!, along[1]!))).toEqual(["card"]);
  });

  it("respects scale", () => {
    const roots = [build({ key: "card", x: 100, y: 100, w: 200, h: 100, scale: 0.5 })];
    expect(hitTest(roots, 120, 110)).toEqual([]);
    expect(keys(hitTest(roots, 160, 130))).toEqual(["card"]);
  });

  it("uses the layer surface for 3D rotations", () => {
    const roots = [build({ key: "door", x: 100, y: 100, w: 200, h: 100, rotationY: 60 })];
    expect(hitTest(roots, 140, 150)).toEqual([]);
    expect(keys(hitTest(roots, 160, 150))).toEqual(["door"]);
    const local = toLocalPoint(roots[0]!, 160, 150)!;
    expect(local[0]).toBeCloseTo(20, 9);
    expect(local[1]).toBeCloseTo(50, 9);
  });

  it("clipping ancestors hide overflowing children", () => {
    const spec = (clip: boolean): Spec => ({
      key: "parent",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      clip,
      type: "group",
      children: [{ key: "child", x: 80, y: 80, w: 50, h: 50 }],
    });
    expect(hitTest([build(spec(true))], 120, 120)).toEqual([]);
    expect(keys(hitTest([build(spec(false))], 120, 120))).toEqual(["child", "parent"]);
    expect(keys(hitTest([build(spec(true))], 90, 90))).toEqual(["child", "parent"]);
  });

  it("skips invisible, disabled, and fully transparent subtrees", () => {
    const withParent = (overrides: Partial<Spec>) => [
      build({ key: "below", x: 0, y: 0, w: 200, h: 200 }),
      build({
        key: "parent",
        type: "group",
        x: 0,
        y: 0,
        w: 200,
        h: 200,
        ...overrides,
        children: [{ key: "child", x: 0, y: 0, w: 50, h: 50 }],
      }),
    ];
    expect(keys(hitTest(withParent({ opacity: 0 }), 10, 10))).toEqual(["below"]);
    expect(keys(hitTest(withParent({ visible: false }), 10, 10))).toEqual(["below"]);
    expect(keys(hitTest(withParent({ props: { enabled: false } }), 10, 10))).toEqual(["below"]);
    expect(keys(hitTest(withParent({ opacity: 0.001 }), 10, 10))).toEqual(["child", "parent"]);
  });

  it("hitTest: false passes touches through but keeps children touchable", () => {
    const overlay = [
      build({ key: "button", x: 0, y: 0, w: 100, h: 100 }),
      build({ key: "overlay", x: 0, y: 0, w: 100, h: 100, props: { hitTest: false } }),
    ];
    expect(keys(hitTest(overlay, 50, 50))).toEqual(["button"]);
    const nested = [
      build({
        key: "screen",
        type: "group",
        x: 0,
        y: 0,
        w: 400,
        h: 400,
        children: [
          {
            key: "passthrough",
            type: "group",
            x: 0,
            y: 0,
            w: 400,
            h: 400,
            props: { hitTest: false },
            children: [{ key: "btn", x: 10, y: 10, w: 40, h: 40 }],
          },
        ],
      }),
    ];
    expect(keys(hitTest(nested, 20, 20))).toEqual(["btn", "screen"]);
    expect(keys(hitTest(nested, 200, 200))).toEqual(["screen"]);
  });

  it("hit slop is measured in points on screen", () => {
    const roots = [build({ key: "btn", x: 100, y: 100, w: 20, h: 20, props: { hitSlop: 8 } })];
    expect(keys(hitTest(roots, 93, 110))).toEqual(["btn"]);
    expect(hitTest(roots, 91, 110)).toEqual([]);
    const scaled = [
      build({
        key: "zoom",
        type: "group",
        x: 0,
        y: 0,
        w: 400,
        h: 400,
        scale: 2,
        pivot: [0, 0],
        props: { hitTest: false },
        children: [{ key: "btn", x: 50, y: 50, w: 10, h: 10, props: { hitSlop: 8 } }],
      }),
    ];
    expect(keys(hitTest(scaled, 93, 110))).toEqual(["btn"]);
    expect(hitTest(scaled, 91, 110)).toEqual([]);
  });

  it("ignores Color Fill layers as targets", () => {
    const roots = [
      build({
        key: "group",
        type: "group",
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        children: [{ key: "fill", type: "colorFill", x: 0, y: 0, w: 100, h: 100 }],
      }),
    ];
    expect(keys(hitTest(roots, 50, 50))).toEqual(["group"]);
    expect(isInteractive(roots[0]!.children[0]!)).toBe(false);
  });

  it("scale 0 layers can't be hit", () => {
    const roots = [build({ key: "gone", x: 0, y: 0, w: 100, h: 100, scale: 0 })];
    expect(hitTest(roots, 50, 50)).toEqual([]);
    expect(containsPoint(roots[0]!, 50, 50)).toBe(false);
  });
});
