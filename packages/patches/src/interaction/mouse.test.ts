import { describe, expect, it } from "vitest";
import { pointerEvent } from "@sonobe/engine/testing";
import { mouse } from "./mouse.ts";
import { createInteractionRig } from "./testing.ts";

describe("mouse", () => {
  it("starts at the origin with nothing pressed", () => {
    expect(createInteractionRig(mouse).step().outputs).toEqual({
      position: [0, 0],
      left: false,
      right: false,
      middle: false,
      scrollDelta: [0, 0],
      scrollVelocity: [0, 0],
    });
  });

  it("follows the pointer with or without a press and holds after it leaves", () => {
    const r = createInteractionRig(mouse);
    r.step();
    expect(r.step({ events: [pointerEvent("move", 40, 60)] }).outputs.position).toEqual([40, 60]);
    const pressed = r.step({ events: [pointerEvent("down", 50, 70)] });
    expect(pressed.outputs.position).toEqual([50, 70]);
    expect(pressed.outputs.left).toBe(true);
    expect(pressed.outputs.right).toBe(false);
    const released = r.step({ events: [pointerEvent("up", 55, 75)] });
    expect(released.outputs.left).toBe(false);
    expect(released.outputs.position).toEqual([55, 75]);
    expect(r.step({ events: [pointerEvent("leave", 55, 75)] }).outputs.position).toEqual([55, 75]);
  });

  it("reports this frame's wheel delta and its speed per second", () => {
    const r = createInteractionRig(mouse);
    r.step();
    const scrolled = r.step({ events: [{ kind: "wheel", x: 10, y: 10, dx: 2, dy: 5 }, { kind: "wheel", x: 10, y: 10, dx: 0, dy: 3 }] });
    expect(scrolled.outputs.scrollDelta).toEqual([2, 8]);
    expect((scrolled.outputs.scrollVelocity as number[])[1]).toBeCloseTo(480, 9);
    const at120 = createInteractionRig(mouse, { fps: 120 });
    at120.step();
    expect((at120.step({ events: [{ kind: "wheel", x: 0, y: 0, dx: 0, dy: 4 }] }).outputs.scrollVelocity as number[])[1]).toBeCloseTo(480, 9);
    expect(r.step().outputs.scrollDelta).toEqual([0, 0]);
  });

  it("reports which buttons are held from the pointer's buttons bitmask", () => {
    const r = createInteractionRig(mouse);
    r.step();
    const right = r.step({ events: [{ kind: "pointer", phase: "down", pointerId: 1, pointerType: "mouse", x: 10, y: 10, button: 2, buttons: 2 }] });
    expect([right.outputs.left, right.outputs.right, right.outputs.middle]).toEqual([false, true, false]);
    const both = r.step({ events: [{ kind: "pointer", phase: "move", pointerId: 1, pointerType: "mouse", x: 12, y: 10, buttons: 6 }] });
    expect([both.outputs.left, both.outputs.right, both.outputs.middle]).toEqual([false, true, true]);
    const up = r.step({ events: [{ kind: "pointer", phase: "up", pointerId: 1, pointerType: "mouse", x: 12, y: 10, button: 2, buttons: 0 }] });
    expect([up.outputs.left, up.outputs.right, up.outputs.middle]).toEqual([false, false, false]);
    const finger = r.step({ events: [pointerEvent("down", 30, 30, { pointerType: "touch" })] });
    expect([finger.outputs.left, finger.outputs.right]).toEqual([true, false]);
  });

  it("resets on restart", () => {
    const r = createInteractionRig(mouse);
    r.step({ events: [pointerEvent("move", 40, 60)] });
    r.harness.restart();
    r.pointer.reset();
    expect(r.step().outputs.position).toEqual([0, 0]);
  });
});
