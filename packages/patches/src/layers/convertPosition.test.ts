import { describe, expect, it } from "vitest";
import type { LayerRef } from "@sonobe/core";
import type { LayerInfoSnapshot } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { convertPosition } from "./convertPosition.ts";

/** A card inside a panel scaled 2× about its center. The card is disabled, which doesn't matter. */
function scene(panel: Partial<LayerInfoSnapshot> = {}): Record<string, LayerInfoSnapshot> {
  return {
    panel: { enabled: true, position: [40, 100], size: [200, 200], scale: [2, 2], anchor: [0, 0], parent: null, contentSize: [60, 70], ...panel },
    card: { enabled: false, position: [10, 20], size: [50, 50], scale: [1, 1], anchor: [0, 0], parent: "panel", contentSize: [0, 0] },
  };
}

function harness(inputs: Record<string, unknown>, infos = scene()) {
  return createPatchHarness(convertPosition, { inputs, services: { layerInfo: (ref: LayerRef) => infos[ref.layerId] } });
}

describe("convertPosition", () => {
  it("converts a layer point to screen coordinates through every ancestor's scale", () => {
    const h = harness({ fromLayer: { layerId: "card" }, anchor: [1, 0] });
    expect(h.step().outputs).toEqual({ convertedPosition: [60, 40], error: false });
  });

  it("converts screen coordinates into a layer's space, measured from To Anchor", () => {
    const h = harness({ position: [60, 40], toLayer: { layerId: "card" } });
    expect(h.step().outputs).toEqual({ convertedPosition: [50, 0], error: false });
    h.set({ toAnchor: [0.5, 0.5] });
    expect(h.step().outputs.convertedPosition).toEqual([25, -25]);
  });

  it("converts screen to screen when both layers are empty", () => {
    const h = harness({ anchor: [0.5, 0.5], position: [10, 0] });
    expect(h.step().outputs).toEqual({ convertedPosition: [211, 437], error: false });
  });

  it("gives anchor ⊙ size + position − toAnchor ⊙ size for the same layer", () => {
    const h = harness({ fromLayer: { layerId: "card" }, toLayer: { layerId: "card" }, anchor: [1, 1], position: [5, 5], toAnchor: [0.5, 0.5] });
    expect(h.step().outputs.convertedPosition).toEqual([30, 30]);
  });

  it("extrapolates anchors outside 0–1", () => {
    const h = harness({ fromLayer: { layerId: "card" }, anchor: [0, 1.2] });
    expect(h.step().outputs.convertedPosition).toEqual([-40, 160]);
  });

  it("raises Error and holds the last good value when a layer is missing", () => {
    const h = harness({ fromLayer: { layerId: "ghost" } });
    expect(h.step().outputs).toEqual({ convertedPosition: [0, 0], error: true });
    h.set({ fromLayer: { layerId: "card" }, anchor: [1, 0] });
    expect(h.step().outputs).toEqual({ convertedPosition: [60, 40], error: false });
    h.set({ toLayer: { layerId: "ghost" } });
    expect(h.step().outputs).toEqual({ convertedPosition: [60, 40], error: true });
    h.set({ toLayer: null });
    expect(h.step().outputs).toEqual({ convertedPosition: [60, 40], error: false });
    expect(h.logs).toEqual([]);
  });

  it("raises Error when To Layer's chain can't be inverted, but a flat From Layer collapses toward its pivot", () => {
    const flat = scene({ scale: [0, 2] });
    expect(harness({ position: [60, 40], toLayer: { layerId: "card" } }, flat).step().outputs.error).toBe(true);
    const collapsed = scene({ scale: [0, 0] });
    expect(harness({ fromLayer: { layerId: "card" }, anchor: [1, 0] }, collapsed).step().outputs).toEqual({ convertedPosition: [140, 200], error: false });
  });

  it("holds the last value and warns once for a non-finite result", () => {
    const h = harness({ fromLayer: { layerId: "card" } }, scene({ position: [Number.POSITIVE_INFINITY, 0] }));
    h.run(3);
    expect(h.output("convertedPosition")).toEqual([0, 0]);
    expect(h.output("error")).toBe(true);
    expect(h.logs.map((l) => l.message)).toEqual(["Convert Position: the converted position isn't a finite number; holding the last good value."]);
  });

  it("keeps the last good value per loop index", () => {
    const h = harness({ fromLayer: loopOf([{ layerId: "card" }, { layerId: "ghost" }]), anchor: [1, 0] });
    const frame = h.step();
    expect(frame.outputs.convertedPosition).toEqual(loopOf([[60, 40], [0, 0]]));
    expect(frame.outputs.error).toEqual(loopOf([false, true]));
    expect(h.state(0)).toEqual({ last: [60, 40] });
    expect(h.state(1)).toEqual({ last: [0, 0] });
  });

  it("passes Position through while muted", () => {
    const result = runPatch(convertPosition, [{ position: [7, 8], fromLayer: { layer: "card" } }], { muted: true });
    expect(result.frames[0]!.outputs).toEqual({ convertedPosition: [7, 8], error: false });
  });

  it("resets the last value on restart", () => {
    const h = harness({ fromLayer: { layerId: "card" } });
    h.step();
    expect(h.state(0)).toEqual({ last: [-40, 40] });
    h.restart();
    h.set({ fromLayer: { layerId: "ghost" } });
    expect(h.step().outputs.convertedPosition).toEqual([0, 0]);
  });
});
