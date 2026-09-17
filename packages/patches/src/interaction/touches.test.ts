import { describe, expect, it } from "vitest";
import { pointerEvent } from "@sonobe/engine/testing";
import type { InputEvent, PointerInfo, RuntimeServices } from "@sonobe/engine";
import { loopOf } from "../infra/index.ts";
import { touches } from "./touches.ts";
import { createInteractionRig } from "./testing.ts";

const idle = { positions: loopOf([]), pressures: loopOf([]), ids: loopOf([]), count: 0, json: [] };

const touch = (phase: "down" | "move" | "up" | "cancel", x: number, y: number, pointerId: number, pressure?: number): InputEvent => {
  const event: InputEvent = { kind: "pointer", phase, pointerId, pointerType: "touch", x, y };
  if (pressure !== undefined) event.pressure = pressure;
  return event;
};

describe("touches", () => {
  it("outputs empty loops when nothing is pressed", () => {
    expect(createInteractionRig(touches).step().outputs).toEqual(idle);
  });

  it("reports every pressed finger in press order, with pointer ids and pressures, until they lift", () => {
    const r = createInteractionRig(touches);
    r.step();
    const pressed = r.step({ events: [touch("down", 30, 40, 5, 0.8)] });
    expect(pressed.outputs).toEqual({ positions: loopOf([[30, 40]]), pressures: loopOf([0.8]), ids: loopOf([5]), count: 1, json: [{ id: 5, position: [30, 40], pressure: 0.8 }] });
    const second = r.step({ events: [touch("down", 90, 40, 2)] });
    expect(second.outputs.count).toBe(2);
    expect(second.outputs.ids).toEqual(loopOf([5, 2]));
    expect(second.outputs.positions).toEqual(loopOf([[30, 40], [90, 40]]));
    expect(second.outputs.pressures).toEqual(loopOf([0.8, 0.5]));
    const moved = r.step({ events: [touch("move", 100, 60, 2, 0.25)] });
    expect(moved.outputs.json).toEqual([{ id: 5, position: [30, 40], pressure: 0.8 }, { id: 2, position: [100, 60], pressure: 0.25 }]);
    const lifted = r.step({ events: [touch("up", 30, 40, 5)] });
    expect(lifted.outputs.ids).toEqual(loopOf([2]));
    expect(r.step({ events: [touch("cancel", 100, 60, 2)] }).outputs).toEqual(idle);
  });

  it("counts only touches that started on the layer, even after they slide off", () => {
    const r = createInteractionRig(touches, { inputs: { layer: { layerId: "pad" } }, layers: [{ id: "pad", rect: [0, 0, 100, 100] }] });
    r.step();
    expect(r.step({ events: [pointerEvent("down", 200, 200)] }).outputs.count).toBe(0);
    expect(r.step({ events: [touch("down", 50, 50, 2)] }).outputs.count).toBe(1);
    expect(r.step({ events: [touch("move", 300, 300, 2)] }).outputs.positions).toEqual(loopOf([[300, 300]]));
  });

  it("orders host pointers by press time then id and skips non-finite positions", () => {
    const pointers = (): PointerInfo[] => [
      { id: 7, position: [10, 10], pressure: 0.3, startTime: 2, buttons: 1 },
      { id: 3, position: [20, 20], pressure: 0.8, startTime: 1, buttons: 1 },
      { id: 1, position: [30, 30], pressure: 4, startTime: 2, buttons: 1 },
      { id: 4, position: [Number.NaN, 0], pressure: 1, startTime: 0, buttons: 1 },
    ];
    const r = createInteractionRig(touches, { services: { pointers } as Partial<RuntimeServices> });
    const f = r.step();
    expect(f.outputs.ids).toEqual(loopOf([3, 1, 7]));
    expect(f.outputs.positions).toEqual(loopOf([[20, 20], [30, 30], [10, 10]]));
    expect(f.outputs.pressures).toEqual(loopOf([0.8, 1, 0.3]));
    expect(f.outputs.count).toBe(3);
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
