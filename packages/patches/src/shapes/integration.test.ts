/** Shape patches wired into real runtime documents: gestures and animations driving Shape layers. */

import { describe, expect, it } from "vitest";
import { squirclePath } from "@sonobe/engine";
import type { SceneNode, SonobeRuntime } from "@sonobe/engine";
import { buildDoc, createMockRegistry, createTestRuntime, runFrames, tap } from "@sonobe/engine/testing";
import { createPatchRegistry } from "../registry.ts";
import { definitions } from "./index.ts";
import { formatPath, parsePath } from "./path.ts";

const registry = createMockRegistry(definitions);

function findNode(nodes: readonly SceneNode[], key: string): SceneNode | undefined {
  for (const node of nodes) {
    if (node.key === key) return node;
    const child = findNode(node.children, key);
    if (child) return child;
  }
  return undefined;
}

const shapeOf = (rt: SonobeRuntime, key: string) => (findNode(rt.scene().roots, key)?.props.shape as { path: string } | null | undefined)?.path;

describe("shapes in a running prototype", () => {
  it("interaction → switch → pop animation → transition → rounded rectangle morphs a square into a circle", () => {
    const doc = buildDoc(
      {
        layers: [{ id: "avatar_frame", type: "shape", name: "Avatar Frame", props: { position: [151, 380], size: [100, 100], shape: { link: "frame.shape" } } }],
        patches: {
          tap_frame: { type: "interaction", inputs: { layer: { layer: "avatar_frame" } } },
          round: { type: "switch", inputs: { flip: { link: "tap_frame.tap" } } },
          pop: { type: "popAnimation", inputs: { number: { link: "round.on" }, bounciness: 4, speed: 12 } },
          radius: { type: "transition", typeParam: "number", inputs: { progress: { link: "pop.output" }, start: 16, end: 50 } },
          frame: { type: "roundedRectangleShape", inputs: { position: [50, 50], size: [100, 100], cornerRadius: { link: "radius.output" } } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 2);
    expect(shapeOf(rt, "avatar_frame")).toBe(squirclePath(0, 0, 100, 100, [16, 16, 16, 16], 0));

    runFrames(rt, 2, tap(201, 430));
    expect(rt.getValue("round.on")).toBe(true);
    runFrames(rt, 5);
    const midway = rt.getValue("radius.output") as number;
    expect(midway).toBeGreaterThan(16);
    expect(shapeOf(rt, "avatar_frame")).toBe(squirclePath(0, 0, 100, 100, [midway, midway, midway, midway], 0));

    runFrames(rt, 240);
    expect(rt.getValue("pop.output")).toBeCloseTo(1, 3);
    const settled = rt.getValue("radius.output") as number;
    expect(settled).toBeCloseTo(50, 2);
    expect(shapeOf(rt, "avatar_frame")).toBe(squirclePath(0, 0, 100, 100, [settled, settled, settled, settled], 0));
    expect(rt.issues()).toEqual([]);
  });

  it("shape union combines a rounded body and a counter-clockwise tail into one clockwise path", () => {
    const doc = buildDoc(
      {
        layers: [{ id: "bubble", type: "shape", name: "Bubble", props: { position: [40, 300], size: [240, 112], shape: { link: "bubble_shape.shape" } } }],
        patches: {
          body: { type: "roundedRectangleShape", inputs: { position: [120, 48], size: [240, 96], cornerRadius: 20 } },
          tail: { type: "triangleShape", inputs: { firstPoint: [28, 90], secondPoint: [18, 112], thirdPoint: [60, 90] } },
          bubble_shape: { type: "shapeUnion", inputCount: 2, inputs: { shape1: { link: "body.shape" }, shape2: { link: "tail.shape" } } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 1);
    const body = formatPath(parsePath(squirclePath(0, 0, 240, 96, [20, 20, 20, 20], 0)).segments);
    expect(shapeOf(rt, "bubble")).toBe(`${body} M28 90 L60 90 L18 112 L28 90 Z`);
  });

  it("a loop of radii replicates the Shape layer, one circle per item", () => {
    const doc = buildDoc(
      {
        layers: [{ id: "dots", type: "shape", name: "Dots", props: { size: [60, 60], shape: { link: "dot.shape" } } }],
        patches: { dot: { type: "circleShape", inputs: { position: [30, 30], radius: { loop: [10, 20, 0] } } } },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 1);
    expect(shapeOf(rt, "dots#0")).toBe("M30 20 A10 10 0 0 1 40 30 A10 10 0 0 1 30 40 A10 10 0 0 1 20 30 A10 10 0 0 1 30 20 Z");
    expect(shapeOf(rt, "dots#1")).toBe("M30 10 A20 20 0 0 1 50 30 A20 20 0 0 1 30 50 A20 20 0 0 1 10 30 A20 20 0 0 1 30 10 Z");
    expect(shapeOf(rt, "dots#2")).toBe("");
  });

  it("SVG Path Shape scales pasted art, and muting it clears the shape", () => {
    const layers = [{ id: "heart", type: "shape", name: "Heart", props: { size: [48, 48], shape: { link: "heart_shape.shape" } } }];
    const heart = { type: "svgPathShape", inputs: { pathData: "M12 21 L3 9 L21 9 Z", viewBox: [0, 0, 24, 24], size: [48, 48] } };
    const rt = createTestRuntime(buildDoc({ layers, patches: { heart_shape: heart } }, registry), registry);
    runFrames(rt, 1);
    expect(shapeOf(rt, "heart")).toBe("M24 42 L6 18 L42 18 Z");
    expect(rt.getValue("heart_shape.error")).toBe(false);

    const muted = createTestRuntime(buildDoc({ layers, patches: { heart_shape: { ...heart, muted: true } } }, registry), registry);
    runFrames(muted, 1);
    expect(muted.getValue("heart_shape.shape")).toBeNull();
    expect(muted.getValue("heart_shape.errorMessage")).toBe("");
  });

  it("every shape patch is implemented in the built-in registry", () => {
    const patches = createPatchRegistry();
    for (const type of ["circleShape", "ovalShape", "roundedRectangleShape", "triangleShape", "lineShape", "svgPathShape", "shapeUnion", "jsonToShape"]) {
      expect(patches.isImplemented(type)).toBe(true);
    }
  });
});
