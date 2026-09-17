import { describe, expect, it } from "vitest";
import { pointerEvent } from "@sonobe/engine/testing";
import { hover } from "./hover.ts";
import { createInteractionRig, type RigLayer } from "./testing.ts";

const button: RigLayer = { id: "button", rect: [100, 100, 100, 50] };

function rig(inputs: Record<string, unknown> = { layer: { layerId: "button" } }, layers: RigLayer[] = [button]) {
  return createInteractionRig(hover, { inputs, layers, screen: [390, 844] });
}

describe("hover", () => {
  it("is false until the pointer moves over the layer", () => {
    expect(rig().step().outputs).toEqual({ hovering: false, position: [0, 0], localPosition: [0, 0] });
  });

  it("follows a mouse over the layer and holds the last position after it leaves", () => {
    const r = rig();
    r.step();
    const over = r.step({ events: [pointerEvent("move", 150, 120)] });
    expect(over.outputs).toEqual({ hovering: true, position: [150, 120], localPosition: [50, 20] });
    const off = r.step({ events: [pointerEvent("move", 20, 20)] });
    expect(off.outputs).toEqual({ hovering: false, position: [150, 120], localPosition: [50, 20] });
  });

  it("counts children and is blocked by layers in front", () => {
    const layers: RigLayer[] = [button, { id: "icon", rect: [110, 110, 20, 20], parent: "button" }, { id: "badge", rect: [180, 100, 40, 40] }];
    const r = rig({ layer: { layerId: "button" } }, layers);
    r.step();
    expect(r.step({ events: [pointerEvent("move", 120, 120)] }).outputs.hovering).toBe(true);
    expect(r.step({ events: [pointerEvent("move", 190, 120)] }).outputs.hovering).toBe(false);
  });

  it("keeps hovering while a mouse button is held over the layer", () => {
    const r = rig();
    r.step();
    r.step({ events: [pointerEvent("move", 150, 120)] });
    expect(r.step({ events: [pointerEvent("down", 150, 120)] }).outputs.hovering).toBe(true);
    expect(r.step({ events: [pointerEvent("move", 160, 125)] }).outputs.hovering).toBe(true);
    expect(r.step({ events: [pointerEvent("move", 20, 20)] }).outputs.hovering).toBe(false);
    expect(r.step({ events: [pointerEvent("up", 150, 120)] }).outputs.hovering).toBe(true);
  });

  it("never hovers with a touch that isn't pressed", () => {
    const r = rig();
    r.step();
    expect(r.step({ events: [pointerEvent("move", 150, 120, { pointerType: "touch" })] }).outputs.hovering).toBe(false);
  });

  it("watches the whole prototype when Layer is empty, and clears when the pointer leaves", () => {
    const r = rig({});
    r.step();
    expect(r.step({ events: [pointerEvent("move", 20, 20)] }).outputs).toEqual({ hovering: true, position: [20, 20], localPosition: [20, 20] });
    expect(r.step({ events: [pointerEvent("move", 400, 20)] }).outputs.hovering).toBe(false);
    r.step({ events: [pointerEvent("move", 30, 30)] });
    expect(r.step({ events: [pointerEvent("leave", 30, 30)] }).outputs.hovering).toBe(false);
  });

  it("is false while disabled or for a missing layer", () => {
    const disabled = rig({ layer: { layerId: "button" }, enabled: false });
    disabled.step();
    expect(disabled.step({ events: [pointerEvent("move", 150, 120)] }).outputs).toEqual({ hovering: false, position: [0, 0], localPosition: [0, 0] });
    const missing = rig({ layer: { layerId: "gone" } });
    missing.step();
    expect(missing.step({ events: [pointerEvent("move", 150, 120)] }).outputs.hovering).toBe(false);
  });
});
