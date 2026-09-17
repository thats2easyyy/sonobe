import { describe, expect, it } from "vitest";
import type { LayerRef } from "@sonobe/core";
import { mat4 } from "@sonobe/engine";
import type { LayerInfoSnapshot } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { convertPosition } from "./convertPosition.ts";

interface Frame {
  position: [number, number];
  size: [number, number];
  scale?: [number, number];
  rotation?: number;
  enabled?: boolean;
  contentSize?: [number, number];
}

/** A snapshot the way the engine builds one: the local transform composed onto the parent's world transform. */
function snapshot(frame: Frame, parent: { ref: LayerRef; world: number[] } | null): LayerInfoSnapshot {
  const scale = frame.scale ?? [1, 1];
  const local = mat4.compose({ position: frame.position, size: frame.size, scale: [scale[0], scale[1], 1], rotationZ: frame.rotation ?? 0 });
  return {
    type: "rectangle",
    enabled: frame.enabled ?? true,
    position: frame.position,
    size: frame.size,
    scale,
    anchor: [0, 0],
    parent: parent?.ref ?? null,
    worldTransform: parent ? mat4.multiply(parent.world, local) : local,
    contentSize: frame.contentSize ?? [0, 0],
  };
}

/** A card inside a panel scaled 2× about its center. The card is disabled, which doesn't matter. */
function scene(panel: Partial<Frame> = {}): Record<string, LayerInfoSnapshot> {
  const panelInfo = snapshot({ position: [40, 100], size: [200, 200], scale: [2, 2], contentSize: [60, 70], ...panel }, null);
  const card = snapshot({ position: [10, 20], size: [50, 50], enabled: false }, { ref: { layerId: "panel" }, world: panelInfo.worldTransform });
  return { panel: panelInfo, card };
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

  it("follows rotation exactly, in both directions", () => {
    const rotated = scene({ scale: [1, 1], rotation: 90 });
    const card = rotated.card!;
    const [x, y] = mat4.transformPoint(card.worldTransform, [50, 50]);
    const out = harness({ fromLayer: { layerId: "card" }, anchor: [1, 1] }, rotated).step().outputs.convertedPosition as number[];
    expect(out[0]).toBeCloseTo(x, 9);
    expect(out[1]).toBeCloseTo(y, 9);
    // The panel turns 90° clockwise on screen about its center (140, 200): the card's corner (60, 70) in panel space,
    // 40 left of and 30 above the pivot, lands 30 right of and 40 above it.
    expect(out[0]).toBeCloseTo(170, 9);
    expect(out[1]).toBeCloseTo(160, 9);
    const back = harness({ position: [170, 160], toLayer: { layerId: "card" } }, rotated).step().outputs.convertedPosition as number[];
    expect(back[0]).toBeCloseTo(50, 9);
    expect(back[1]).toBeCloseTo(50, 9);
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

  it("raises Error when To Layer's transform can't be inverted, but a flat From Layer collapses toward its pivot", () => {
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
