import { describe, expect, it } from "vitest";
import type { LayerRef } from "@sonobe/core";
import type { LayerInfoSnapshot } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { layerInfo } from "./layerInfo.ts";

const snapshot = (over: Partial<LayerInfoSnapshot> = {}): LayerInfoSnapshot => ({
  enabled: true,
  position: [16, 96],
  size: [120, 40],
  scale: [1.5, 2],
  anchor: [0.5, 0.5],
  parent: "panel",
  contentSize: [100, 30],
  ...over,
});

const MISSING = { size: [0, 0], position: [0, 0], scale: 1, anchor: [0, 0], enabled: false, parent: null, contentSize: [0, 0] };

describe("layerInfo", () => {
  it("reports the previous frame's geometry", () => {
    const seen: LayerRef[] = [];
    const h = createPatchHarness(layerInfo, {
      inputs: { layer: { layerId: "label" } },
      services: {
        layerInfo: (ref) => {
          seen.push(ref);
          return ref.layerId === "label" ? snapshot() : undefined;
        },
      },
    });
    expect(h.step().outputs).toEqual({ size: [120, 40], position: [16, 96], scale: 1.5, anchor: [0.5, 0.5], enabled: true, parent: { layerId: "panel" }, contentSize: [100, 30] });
    expect(seen).toEqual([{ layerId: "label" }]);
  });

  it("outputs a null parent for a top-level layer", () => {
    const h = createPatchHarness(layerInfo, { inputs: { layer: { layerId: "label" } }, services: { layerInfo: () => snapshot({ parent: null, enabled: false }) } });
    const { outputs } = h.step();
    expect(outputs.parent).toBeNull();
    expect(outputs.enabled).toBe(false);
  });

  it("carries a looped layer's instance into Parent", () => {
    const h = createPatchHarness(layerInfo, { inputs: { layer: { layerId: "badge", instance: 2 } }, services: { layerInfo: () => snapshot({ parent: "card" }) } });
    expect(h.step().outputs.parent).toEqual({ layerId: "card", instance: 2 });
  });

  it("outputs the missing-layer values for an empty or unknown layer", () => {
    const h = createPatchHarness(layerInfo, { services: { layerInfo: () => snapshot() } });
    expect(h.step().outputs).toEqual(MISSING);
    const unknown = createPatchHarness(layerInfo, { inputs: { layer: { layerId: "ghost" } }, services: { layerInfo: () => undefined } });
    expect(unknown.step().outputs).toEqual(MISSING);
    expect(unknown.logs).toEqual([]);
  });

  it("replaces non-finite components and warns once per output", () => {
    const h = createPatchHarness(layerInfo, {
      inputs: { layer: { layerId: "label" } },
      services: { layerInfo: () => snapshot({ size: [Number.NaN, 40], scale: [Number.POSITIVE_INFINITY, 1] }) },
    });
    h.run(3);
    expect(h.output("size")).toEqual([0, 40]);
    expect(h.output("scale")).toBe(1);
    expect(h.logs.map((l) => l.message)).toEqual(["Layer Info: Size isn't a finite number; using 0.", "Layer Info: Scale isn't a finite number; using 1."]);
  });

  it("evaluates once per copy of a looped layer", () => {
    const h = createPatchHarness(layerInfo, {
      inputs: { layer: loopOf([{ layerId: "row", instance: 0 }, { layerId: "row", instance: 1 }, { layerId: "row", instance: 5 }]) },
      services: { layerInfo: (ref) => (ref.instance === 5 ? undefined : snapshot({ position: [0, 60 * (ref.instance ?? 0)], parent: "list" })) },
    });
    const { outputs } = h.step();
    expect(outputs.position).toEqual(loopOf([[0, 0], [0, 60], [0, 0]]));
    expect(outputs.scale).toEqual(loopOf([1.5, 1.5, 1]));
    expect(outputs.parent).toEqual(loopOf([{ layerId: "list", instance: 0 }, { layerId: "list", instance: 1 }, null]));
  });

  it("outputs the missing-layer values while muted", () => {
    const services = { layerInfo: () => snapshot() };
    expect(runPatch(layerInfo, [{ layer: { layer: "label" } }], { services }).frames[0]!.outputs.size).toEqual([120, 40]);
    expect(runPatch(layerInfo, [{ layer: { layer: "label" } }], { services, muted: true }).frames[0]!.outputs).toEqual(MISSING);
  });
});
