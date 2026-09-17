import { describe, expect, it } from "vitest";
import { pointerEvent } from "@sonobe/engine/testing";
import { loopOf } from "../infra/index.ts";
import { longPress } from "./longPress.ts";
import { createInteractionRig } from "./testing.ts";

function rig(inputs: Record<string, unknown> = {}, fps = 60) {
  return createInteractionRig(longPress, { inputs: { layer: { layerId: "card" }, ...inputs }, layers: [{ id: "card", rect: [0, 0, 200, 200] }], fps });
}

/** Seconds from the press until Long Press turned on. */
function recognitionDelay(fps: number): number {
  const r = rig({}, fps);
  r.step();
  const press = r.step({ events: [pointerEvent("down", 50, 50)] });
  for (let i = 0; i < fps * 2; i++) {
    const f = r.step();
    if (f.outputs.longPress === true) return f.time - press.time;
  }
  return Number.NaN;
}

describe("longPress", () => {
  it("turns on after holding still for Duration, with Progress ramping to 1", () => {
    const r = rig();
    r.step();
    const press = r.step({ events: [pointerEvent("down", 50, 50)] });
    expect(press.outputs).toEqual({ longPress: false, progress: 0 });
    expect(press.requestedNextFrame).toBe(true);
    const mid = r.run(15);
    expect(mid.outputs.longPress).toBe(false);
    expect(mid.outputs.progress).toBeCloseTo(0.5, 9);
    const on = r.run(15);
    expect(on.outputs).toEqual({ longPress: true, progress: 1 });
    expect(on.requestedNextFrame).toBe(false);
    const release = r.step({ events: [pointerEvent("up", 50, 50)] });
    expect(release.outputs).toEqual({ longPress: false, progress: 0 });
    expect(release.pulses.has("tap")).toBe(false);
  });

  it("turns on at the same moment at 60 and 120 fps", () => {
    expect(recognitionDelay(60)).toBeCloseTo(0.5, 6);
    expect(recognitionDelay(120)).toBeCloseTo(0.5, 6);
  });

  it("taps when released before recognition", () => {
    const r = rig();
    r.step();
    r.step({ events: [pointerEvent("down", 50, 50)] });
    r.run(10);
    const up = r.step({ events: [pointerEvent("up", 50, 50)] });
    expect(up.pulses.has("tap")).toBe(true);
    expect(up.outputs.longPress).toBe(false);
  });

  it("gives up for good once the press moves 10 points before recognition", () => {
    const r = rig();
    r.step();
    r.step({ events: [pointerEvent("down", 50, 50)] });
    r.run(5);
    const moved = r.step({ events: [pointerEvent("move", 62, 50)] });
    expect(moved.outputs.progress).toBe(0);
    r.step({ events: [pointerEvent("move", 50, 50)] });
    const later = r.run(60);
    expect(later.outputs).toEqual({ longPress: false, progress: 0 });
    const up = r.step({ events: [pointerEvent("up", 50, 50)] });
    expect(up.pulses.has("tap")).toBe(false);
  });

  it("stays on through movement after recognition", () => {
    const r = rig({ duration: 0.1 });
    r.step();
    r.step({ events: [pointerEvent("down", 50, 50)] });
    r.run(10);
    expect(r.step({ events: [pointerEvent("move", 150, 150)] }).outputs.longPress).toBe(true);
  });

  it("times a connected Down with no movement check", () => {
    const r = createInteractionRig(longPress, { inputs: { down: false, duration: 0.25 } });
    r.step();
    r.step({ inputs: { down: true } });
    expect(r.run(14).outputs.longPress).toBe(false);
    expect(r.step().outputs.longPress).toBe(true);
    r.step({ inputs: { down: false } });
    r.step({ inputs: { down: true } });
    const tapFrame = r.step({ inputs: { down: false } });
    expect(tapFrame.pulses.has("tap")).toBe(true);
  });

  it("starts timing on frame 0 when Down is already on", () => {
    const r = createInteractionRig(longPress, { inputs: { down: true, duration: 0.5 } });
    r.step();
    expect(r.run(30).outputs.longPress).toBe(true);
  });

  it("turns on immediately with a zero or negative Duration", () => {
    const r = rig({ duration: -1 });
    r.step();
    expect(r.step({ events: [pointerEvent("down", 50, 50)] }).outputs).toEqual({ longPress: true, progress: 1 });
  });

  it("turns on at once when Duration is lowered mid-press", () => {
    const r = rig({ duration: 2 });
    r.step();
    r.step({ events: [pointerEvent("down", 50, 50)] });
    r.run(30);
    expect(r.step({ inputs: { duration: 0.3 } }).outputs.longPress).toBe(true);
  });

  it("drops a press while disabled and ignores it until it lifts", () => {
    const r = rig({ duration: 0.1 });
    r.step();
    r.step({ events: [pointerEvent("down", 50, 50)] });
    r.step({ inputs: { enabled: false } });
    const reenabled = r.run(20, { inputs: { enabled: true } });
    expect(reenabled.outputs).toEqual({ longPress: false, progress: 0 });
    const up = r.step({ events: [pointerEvent("up", 50, 50)] });
    expect(up.pulses.has("tap")).toBe(false);
    r.step({ events: [pointerEvent("down", 50, 50)] });
    expect(r.run(10).outputs.longPress).toBe(true);
  });

  it("keeps per-index state for a looped Down", () => {
    const r = createInteractionRig(longPress, { inputs: { down: loopOf([true, false]), duration: 0.1 } });
    r.step();
    const f = r.run(10);
    expect(f.outputs.longPress).toEqual(loopOf([true, false]));
    expect(f.outputs.progress).toEqual(loopOf([1, 0]));
  });
});
