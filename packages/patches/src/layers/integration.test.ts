/** Layer patches wired into real runtime documents: measured geometry, conversion, and effects. */

import { describe, expect, it } from "vitest";
import { mat4 } from "@sonobe/engine";
import type { SceneNode } from "@sonobe/engine";
import { buildDoc, createMockRegistry, createTestRuntime, runFrames, tap } from "@sonobe/engine/testing";
import { createPatchRegistry } from "../registry.ts";
import { definitions } from "./index.ts";

const registry = createMockRegistry(definitions);

function findNode(nodes: readonly SceneNode[], key: string): SceneNode | undefined {
  for (const node of nodes) {
    if (node.key === key) return node;
    const child = findNode(node.children, key);
    if (child) return child;
  }
  return undefined;
}

describe("layer patches in a running prototype", () => {
  it("Convert Position pins a badge to a card inside a scaled group", () => {
    const doc = buildDoc(
      {
        layers: [
          {
            id: "panel",
            type: "group",
            name: "Panel",
            props: { position: [40, 100], size: [200, 200], scale: 2 },
            children: [{ id: "card", type: "rectangle", name: "Card", props: { position: [10, 20], size: [50, 50] } }],
          },
          { id: "badge", type: "oval", name: "Badge", props: { size: [20, 20], anchor: [0.5, 0.5], position: { link: "pin.convertedPosition" } } },
        ],
        patches: { pin: { type: "convertPosition", inputs: { fromLayer: { layer: "card" }, anchor: [1, 0] } } },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 3);
    const card = findNode(rt.scene().roots, "card")!;
    const [x, y] = mat4.transformPoint(card.worldTransform, [50, 0]);
    expect(rt.getValue("pin.error")).toBe(false);
    const converted = rt.getValue("pin.convertedPosition") as number[];
    expect(converted[0]).toBeCloseTo(x, 9);
    expect(converted[1]).toBeCloseTo(y, 9);
    expect(converted).toEqual([60, 40]);
    const badge = findNode(rt.scene().roots, "badge")!;
    expect(mat4.transformPoint(badge.worldTransform, [10, 10]).slice(0, 2)).toEqual([60, 40]);
    expect(rt.issues()).toEqual([]);
  });

  it("Convert Position follows a rotated, pivoted group exactly, both ways", () => {
    const doc = buildDoc(
      {
        layers: [
          {
            id: "dial",
            type: "group",
            name: "Dial",
            props: { position: [80, 120], size: [160, 100], rotation: 30, pivot: [0, 1], scale: 1.5 },
            children: [{ id: "knob", type: "rectangle", name: "Knob", props: { position: [20, 10], size: [40, 30], rotation: -12 } }],
          },
        ],
        patches: {
          to_screen: { type: "convertPosition", inputs: { fromLayer: { layer: "knob" }, anchor: [1, 1], position: [3, -4] } },
          back: { type: "convertPosition", inputs: { toLayer: { layer: "knob" }, position: { link: "to_screen.convertedPosition" } } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 3);
    const knob = findNode(rt.scene().roots, "knob")!;
    const [x, y] = mat4.transformPoint(knob.worldTransform, [43, 26]);
    const converted = rt.getValue("to_screen.convertedPosition") as number[];
    expect(converted[0]).toBeCloseTo(x, 9);
    expect(converted[1]).toBeCloseTo(y, 9);
    const back = rt.getValue("back.convertedPosition") as number[];
    expect(back[0]).toBeCloseTo(43, 9);
    expect(back[1]).toBeCloseTo(26, 9);
    expect(rt.getValue("back.error")).toBe(false);
  });

  it("Layer Info sizes a pill to its label, one frame behind layout", () => {
    const doc = buildDoc(
      {
        layers: [
          { id: "pill", type: "rectangle", name: "Pill", props: { position: [16, 96], size: { link: "pill_size.output" } } },
          { id: "label", type: "rectangle", name: "Label", props: { position: [32, 104], size: [120, 24] } },
        ],
        patches: {
          label_info: { type: "layerInfo", inputs: { layer: { layer: "label" } } },
          pill_size: { type: "add", typeParam: "point", inputCount: 2, inputs: { value1: { link: "label_info.size" }, value2: [32, 16] } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 2);
    expect(rt.getValue("label_info.size")).toEqual([120, 24]);
    expect(rt.getValue("label_info.position")).toEqual([32, 104]);
    expect(rt.getValue("label_info.scale")).toBe(1);
    expect(rt.getValue("label_info.enabled")).toBe(true);
    expect(rt.getValue("label_info.parent")).toBeNull();
    const pill = findNode(rt.scene().roots, "pill")!;
    expect([pill.width, pill.height]).toEqual([152, 40]);

    const label = rt.document.components[rt.document.project.root]!.layers.find((l) => l.id === "label")!;
    const resized = structuredClone(rt.document);
    resized.components[resized.project.root]!.layers.find((l) => l.id === "label")!.props = { ...label.props, size: [200, 30] };
    rt.updateDocument(resized);
    runFrames(rt, 1);
    expect(rt.getValue("label_info.size")).toEqual([120, 24]);
    runFrames(rt, 1);
    expect(rt.getValue("label_info.size")).toEqual([200, 30]);
    runFrames(rt, 1);
    const grown = findNode(rt.scene().roots, "pill")!;
    expect([grown.width, grown.height]).toEqual([232, 46]);
  });

  it("Layer Info and Convert Position evaluate once per copy of a looped layer", () => {
    const doc = buildDoc(
      {
        layers: [
          {
            id: "list",
            type: "group",
            name: "List",
            props: { position: [0, 200], size: [300, 400] },
            children: [{ id: "row", type: "rectangle", name: "Row", props: { size: [300, 50], position: { loop: [[0, 0], [0, 60], [0, 120]] } } }],
          },
        ],
        patches: {
          row_info: { type: "layerInfo", inputs: { layer: { layer: "row" } } },
          row_spot: { type: "convertPosition", inputs: { fromLayer: { layer: "row" } } },
          parent_info: { type: "layerInfo", inputs: { layer: { link: "row_info.parent" } } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 3);
    const spots = rt.getRawValue("row_spot.convertedPosition") as { items: number[][] };
    expect(spots.items).toEqual([[0, 200], [0, 260], [0, 320]]);
    const parents = rt.getRawValue("row_info.parent") as { items: unknown[] };
    // The list isn't replicated, so every row's parent is the one list, with no loop instance.
    expect(parents.items).toEqual([{ layerId: "list" }, { layerId: "list" }, { layerId: "list" }]);
    expect((rt.getRawValue("parent_info.size") as { items: number[][] }).items).toEqual([[300, 400], [300, 400], [300, 400]]);
  });

  it("interaction → switch → pop animation → transition → Blur Effect settles on the layer's Effects", () => {
    const doc = buildDoc(
      {
        layers: [{ id: "photo", type: "rectangle", name: "Photo", props: { position: [0, 0], size: [390, 300], effects: { link: "backdrop.effect" } } }],
        patches: {
          tap_photo: { type: "interaction", inputs: { layer: { layer: "photo" } } },
          blurred: { type: "switch", inputs: { flip: { link: "tap_photo.tap" } } },
          blur_anim: { type: "popAnimation", inputs: { number: { link: "blurred.on" }, bounciness: 3, speed: 16 } },
          blur_amount: { type: "transition", typeParam: "number", inputs: { progress: { link: "blur_anim.output" }, start: 0, end: 20 } },
          backdrop: { type: "blurEffect", inputs: { radius: { link: "blur_amount.output" }, hardEdges: true } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 1);
    expect(findNode(rt.scene().roots, "photo")!.props.effects).toEqual({ kind: "blur", params: { radius: 0, hardEdges: true } });
    runFrames(rt, 2, tap(100, 100));
    runFrames(rt, 240);
    const effects = findNode(rt.scene().roots, "photo")!.props.effects as { kind: string; params: { radius: number; hardEdges: boolean } };
    expect(effects.kind).toBe("blur");
    expect(effects.params.hardEdges).toBe(true);
    expect(effects.params.radius).toBeCloseTo(20, 2);
  });

  it("every layer patch is implemented in the built-in registry", () => {
    const patches = createPatchRegistry();
    for (const type of ["layerInfo", "convertPosition", "blurEffect", "colorControlsEffect", "glassEffect"]) expect(patches.isImplemented(type)).toBe(true);
  });
});
