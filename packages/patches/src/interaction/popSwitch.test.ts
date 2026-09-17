import { describe, expect, it } from "vitest";
import { createSpringState, fromBouncinessSpeed, stepSpring } from "@sonobe/engine";
import { drag, idle, pointerEvent, sequence } from "@sonobe/engine/testing";
import type { HarnessFrame } from "../infra/index.ts";
import { popSwitch } from "./popSwitch.ts";
import { createInteractionRig, type InteractionRig, type RigLayer } from "./testing.ts";

const card: RigLayer = { id: "card", rect: [0, 0, 390, 300] };

function rig(inputs: Record<string, unknown> = {}, layers: RigLayer[] = [card]) {
  return createInteractionRig(popSwitch, { inputs: { layer: { layerId: "card" }, ...inputs }, layers });
}

function settle(r: InteractionRig<unknown>): HarnessFrame {
  let f = r.step();
  for (let i = 0; i < 600 && f.requestedNextFrame; i++) f = r.step();
  return f;
}

const out = (f: HarnessFrame) => f.outputs.output as number;

describe("popSwitch", () => {
  it("starts off at Start, at rest", () => {
    const f = rig().step();
    expect(f.outputs).toEqual({ output: 0, progress: 0, on: false, dragging: false });
    expect(f.requestedNextFrame).toBe(false);
  });

  it("springs to End on Flip with Pop Animation's physics", () => {
    const r = rig({ bounciness: 8, speed: 12 });
    r.step();
    const reference = createSpringState(0, 300);
    const config = fromBouncinessSpeed(8, 12);
    let f = r.step({ pulses: ["flip"] });
    expect(f.outputs.on).toBe(true);
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      stepSpring(reference, config, 1 / 60);
      expect(out(f)).toBeCloseTo(reference.value, 10);
      peak = Math.max(peak, out(f));
      f = r.step();
    }
    expect(peak).toBeGreaterThan(300);
    const rest = settle(r);
    expect(rest.outputs).toMatchObject({ output: 300, progress: 1, on: true });
  });

  it("keeps its velocity when End changes mid-flight", () => {
    const r = rig();
    r.step();
    const config = fromBouncinessSpeed(5, 10);
    const reference = createSpringState(0, 300);
    let f = r.step({ pulses: ["turnOn"] });
    stepSpring(reference, config, 1 / 60);
    for (let i = 0; i < 10; i++) {
      f = r.step();
      stepSpring(reference, config, 1 / 60);
    }
    expect(out(f)).toBeCloseTo(reference.value, 10);
    reference.target = 150;
    f = r.step({ inputs: { end: 150 } });
    stepSpring(reference, config, 1 / 60);
    expect(out(f)).toBeCloseTo(reference.value, 10);
    expect(settle(r).outputs.output).toBe(150);
  });

  it("applies Turn Off, then Turn On, then Flip", () => {
    const r = rig();
    r.step();
    expect(r.step({ pulses: ["turnOff", "turnOn", "flip"] }).outputs.on).toBe(false);
    expect(r.step({ pulses: ["turnOn", "flip"] }).outputs.on).toBe(true);
    expect(r.step({ pulses: ["turnOn"] }).outputs.on).toBe(true);
    expect(r.step({ pulses: ["flip"] }).outputs.on).toBe(false);
  });

  it("follows a swipe and commits to the nearer end on release", () => {
    const r = rig();
    r.step();
    const tracking = r.script(drag([100, 150], [200, 150], { frames: 10, release: false })).at(-1)!;
    expect(tracking.outputs).toMatchObject({ output: 100, dragging: true, on: false });
    expect(tracking.outputs.progress).toBeCloseTo(1 / 3, 9);
    r.script(sequence(idle(15), [[pointerEvent("up", 200, 150)]]));
    const back = settle(r);
    expect(back.outputs).toMatchObject({ output: 0, on: false, dragging: false });

    r.script(sequence(drag([100, 150], [280, 150], { frames: 10, release: false }), idle(15), [[pointerEvent("up", 280, 150)]]));
    expect(settle(r).outputs).toMatchObject({ output: 300, on: true });
  });

  it("projects a flick when deciding where to land", () => {
    const r = rig();
    r.step();
    const frames = r.script(drag([100, 150], [160, 150], { frames: 2 }));
    expect(frames.at(-1)!.outputs.on).toBe(true);
    expect(settle(r).outputs.output).toBe(300);
  });

  it("resists dragging past Start or End", () => {
    const r = rig();
    r.step();
    const f = r.script(sequence(drag([0, 150], [390, 150], { frames: 20, release: false }), [[pointerEvent("move", 500, 150)]])).at(-1)!;
    expect(out(f)).toBeGreaterThan(300);
    expect(out(f)).toBeLessThan(500);
  });

  it("uses a step for Progress when Start equals End", () => {
    const r = rig({ start: 50, end: 50 });
    expect(r.step().outputs).toMatchObject({ output: 50, progress: 1 });
  });

  it("ignores gestures with Gesture None, and warns once for pinches", () => {
    const none = rig({ gesture: "none" });
    none.step();
    expect(none.script(drag([100, 150], [200, 150], { frames: 5, release: false })).at(-1)!.outputs).toMatchObject({ output: 0, dragging: false });
    const pinch = rig({ gesture: "pinchScale" });
    pinch.step();
    pinch.script(drag([100, 150], [200, 150], { frames: 5 }));
    expect(pinch.harness.output("dragging")).toBe(false);
    expect(pinch.harness.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("releases an active swipe when disabled, and keeps taking pulses", () => {
    const r = rig();
    r.step();
    r.script(sequence(drag([100, 150], [280, 150], { frames: 10, release: false }), idle(15)));
    const disabled = r.step({ inputs: { enabled: false } });
    expect(disabled.outputs).toMatchObject({ dragging: false, on: true });
    expect(r.step({ pulses: ["flip"] }).outputs.on).toBe(false);
  });

  it("ends a drag on a pulse, and the touch can't grab again until it lifts", () => {
    const r = rig();
    r.step();
    r.script(drag([100, 150], [150, 150], { frames: 5, release: false }));
    const flipped = r.step({ pulses: ["flip"] });
    expect(flipped.outputs).toMatchObject({ on: true, dragging: false });
    expect(r.step({ events: [pointerEvent("move", 50, 150)] }).outputs.dragging).toBe(false);
    r.step({ events: [pointerEvent("up", 50, 150)] });
    r.step({ events: [pointerEvent("down", 100, 150)] });
    expect(r.step().outputs.dragging).toBe(true);
  });

  it("swipes vertically in the parent's scaled space", () => {
    const layers: RigLayer[] = [{ id: "sheet", rect: [0, 0, 390, 844], scale: [1, 2] }, { ...card, parent: "sheet" }];
    const r = rig({ gesture: "swipeY" }, layers);
    r.step();
    expect(out(r.script(drag([100, 50], [100, 250], { frames: 10, release: false })).at(-1)!)).toBe(100);
  });
});
