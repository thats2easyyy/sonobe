import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { applyDeadZone, gameControllerPatch } from "./gameController.ts";
import type { GamepadSnapshot } from "./platform.ts";

function pad(pressed: number[], overrides: Partial<GamepadSnapshot> = {}): GamepadSnapshot {
  return {
    connected: true,
    mapping: "standard",
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
    axes: [0, 0, 0, 0],
    ...overrides,
  };
}

describe("applyDeadZone", () => {
  it("is radial and rescales past the dead zone", () => {
    expect(applyDeadZone([0.05, 0.05], 0.1)).toEqual([0, 0]);
    expect(applyDeadZone([1, 0], 0.1)).toEqual([1, 0]);
    const half = applyDeadZone([0.55, 0], 0.1);
    expect(half[0]).toBeCloseTo(0.5, 10);
    expect(applyDeadZone([Number.NaN, 0.5], 0)).toEqual([0, 0.5]);
  });
});

describe("gameController", () => {
  it("outputs idle values without a controller", () => {
    const h = createPatchHarness(gameControllerPatch);
    expect(h.step().outputs).toMatchObject({ connected: false, buttonA: false, leftTrigger: 0, dpad: [0, 0], leftThumbstick: [0, 0], acceleration: [0, 0, 0] });
    const empty = createPatchHarness(gameControllerPatch, { services: { platform: { gamepads: () => [null, pad([], { connected: false })] } as never }, inputs: { controller: 1 } });
    expect(empty.step().outputs.connected).toBe(false);
  });

  it("maps the standard layout: face buttons, shoulders, triggers, D-pad, sticks, and menus", () => {
    const snapshot = pad([0, 3, 4, 9, 10, 12, 15, 16], { axes: [0.05, -0.02, 1, 0], motion: { acceleration: [0, -1, 0], rotationRate: [1, 2, Number.NaN] } });
    (snapshot.buttons as { pressed: boolean; value: number }[])[7] = { pressed: true, value: 1.4 };
    (snapshot.buttons as { pressed: boolean; value: number }[])[6] = { pressed: false, value: 0.25 };
    const h = createPatchHarness(gameControllerPatch, { services: { platform: { gamepads: () => [snapshot] } as never } });
    expect(h.step().outputs).toEqual({
      connected: true,
      buttonA: true,
      buttonB: false,
      buttonX: false,
      buttonY: true,
      leftShoulder: true,
      rightShoulder: false,
      leftTrigger: 0.25,
      rightTrigger: 1,
      dpad: [1, -1],
      leftThumbstick: [0, 0],
      rightThumbstick: [1, 0],
      home: true,
      menu: true,
      options: false,
      leftThumbstickButton: true,
      rightThumbstickButton: false,
      acceleration: [0, -1, 0],
      rotationRate: [1, 2, 0],
    });
    expect(h.logs).toEqual([]);
  });

  it("warns once when the controller isn't in the standard layout", () => {
    const h = createPatchHarness(gameControllerPatch, { services: { platform: { gamepads: () => [pad([1], { mapping: "" })] } as never } });
    expect(h.run(3).outputs.buttonB).toBe(true);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("floors and clamps Controller, and reads one controller per loop index", () => {
    const pads = [pad([0]), pad([1])];
    const h = createPatchHarness(gameControllerPatch, { services: { platform: { gamepads: () => pads } as never }, inputs: { controller: -3 } });
    expect(h.step().outputs.buttonA).toBe(true);
    expect(h.step({ inputs: { controller: 1.7 } }).outputs.buttonB).toBe(true);
    expect(h.step({ inputs: { controller: loopOf([0, 1, 2]) } }).outputs.connected).toEqual(loopOf([true, true, false]));
  });

  it("outputs zero values while muted", () => {
    const result = runPatch(gameControllerPatch, [{ deadZone: 0.4 }], { muted: true });
    expect(result.frames[0]!.outputs).toMatchObject({ leftTrigger: 0, connected: false });
  });
});
