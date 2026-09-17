import { describe, expect, it } from "vitest";
import { pointerEvent } from "@sonobe/engine/testing";
import type { RuntimeServices } from "@sonobe/engine";
import { loopOf } from "../infra/index.ts";
import { touches } from "./touches.ts";
import { createInteractionRig } from "./testing.ts";

const idle = { positions: loopOf([]), pressures: loopOf([]), ids: loopOf([]), count: 0, json: [] };

describe("touches", () => {
  it("outputs empty loops when nothing is pressed", () => {
    expect(createInteractionRig(touches).step().outputs).toEqual(idle);
  });

  it("reports the pressed pointer from the snapshot, until it lifts", () => {
    const r = createInteractionRig(touches);
    r.step();
    const pressed = r.step({ events: [pointerEvent("down", 30, 40, { pointerType: "touch" })] });
    expect(pressed.outputs).toEqual({ positions: loopOf([[30, 40]]), pressures: loopOf([1]), ids: loopOf([0]), count: 1, json: [{ id: 0, position: [30, 40], pressure: 1 }] });
    const second = r.step({ events: [pointerEvent("down", 90, 40, { pointerId: 2, pointerType: "touch" })] });
    expect(second.outputs.count).toBe(2);
    expect(r.step({ events: [pointerEvent("up", 30, 40), pointerEvent("up", 90, 40, { pointerId: 2 })] }).outputs).toEqual(idle);
  });

  it("counts only touches that started on the layer", () => {
    const r = createInteractionRig(touches, { inputs: { layer: { layerId: "pad" } }, layers: [{ id: "pad", rect: [0, 0, 100, 100] }] });
    r.step();
    expect(r.step({ events: [pointerEvent("down", 200, 200)] }).outputs.count).toBe(0);
    r.step({ events: [pointerEvent("up", 200, 200)] });
    r.step({ events: [pointerEvent("down", 50, 50)] });
    expect(r.step({ events: [pointerEvent("move", 300, 300)] }).outputs.positions).toEqual(loopOf([[300, 300]]));
  });

  it("uses every finger when the host provides pointers, ordered by press time", () => {
    const pointers = () => [
      { id: 7, position: [10, 10] as [number, number], pressure: 0.3, startTime: 2 },
      { id: 3, position: [20, 20] as [number, number], pressure: 0.8, startTime: 1 },
      { id: 4, position: [Number.NaN, 0] as [number, number], pressure: 1, startTime: 0 },
    ];
    const r = createInteractionRig(touches, { services: { pointers } as Partial<RuntimeServices> });
    const f = r.step();
    expect(f.outputs.ids).toEqual(loopOf([3, 7]));
    expect(f.outputs.positions).toEqual(loopOf([[20, 20], [10, 10]]));
    expect(f.outputs.pressures).toEqual(loopOf([0.8, 0.3]));
    expect(f.outputs.count).toBe(2);
  });

  it("outputs idle values while disabled", () => {
    const r = createInteractionRig(touches, { inputs: { enabled: false } });
    r.step();
    expect(r.step({ events: [pointerEvent("down", 30, 40)] }).outputs).toEqual(idle);
  });

  it("uses the first item of a looped Layer and warns once", () => {
    const r = createInteractionRig(touches, {
      inputs: { layer: loopOf([{ layerId: "a" }, { layerId: "b" }]) },
      layers: [{ id: "a", rect: [0, 0, 50, 50] }, { id: "b", rect: [100, 0, 50, 50] }],
    });
    r.step();
    expect(r.step({ events: [pointerEvent("down", 20, 20)] }).outputs.count).toBe(1);
    r.step();
    expect(r.harness.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });
});
