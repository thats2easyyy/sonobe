import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import type { DeviceMotionSample } from "@sonobe/engine";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { deviceMotionPatch, tiltFromGravity } from "./deviceMotion.ts";

describe("tiltFromGravity", () => {
  it("maps gravity to tilt in degrees", () => {
    expect(tiltFromGravity([0, 0, -1], [5, 5, 5])).toEqual([0, 0, 0]);
    expect(tiltFromGravity([0, -1, 0], [0, 0, 0])).toEqual([90, 0, 0]);
    const rightDown = tiltFromGravity([1, 0, 0], [0, 0, 0]);
    expect(rightDown[0]).toBe(0);
    expect(rightDown[1]).toBeCloseTo(90, 10);
    expect(tiltFromGravity([0, -Math.SQRT1_2, -Math.SQRT1_2], [0, 0, 0])[0]).toBeCloseTo(45, 10);
  });

  it("keeps the previous tilt in free fall", () => {
    expect(tiltFromGravity([0, 0, 0.05], [12, 3, 0])).toEqual([12, 3, 0]);
  });
});

describe("deviceMotion", () => {
  it("is idle with Available false until a sample exists, and keeps polling while enabled", () => {
    const h = createPatchHarness(deviceMotionPatch);
    const f = h.step();
    expect(f.outputs).toEqual({ tilt: [0, 0, 0], acceleration: [0, 0, 0], rotationRate: [0, 0, 0], available: false });
    expect(f.requestedNextFrame).toBe(true);
  });

  it("outputs samples, using attitude when present and gravity otherwise", () => {
    let sample: DeviceMotionSample | undefined = { acceleration: [0, -1, 0], rotationRate: [1, 2, 3], attitude: [10, 20, 30] };
    const h = createPatchHarness(deviceMotionPatch, { services: { platform: { deviceMotion: () => sample as never } } });
    expect(h.step().outputs).toEqual({ tilt: [10, 20, 30], acceleration: [0, -1, 0], rotationRate: [1, 2, 3], available: true });
    sample = { acceleration: [0, -1, 0], rotationRate: [0, 0, 0] };
    expect(h.step().outputs.tilt).toEqual([90, 0, 0]);
    // An attitude of [0, 0, 0] is a real reading (flat, facing its reference direction), not a missing one.
    sample = { acceleration: [0, -1, 0], rotationRate: [0, 0, 0], attitude: [0, 0, 0] };
    expect(h.step().outputs.tilt).toEqual([0, 0, 0]);
    sample = { acceleration: [0, 0, -1], rotationRate: [0, 0, 0] };
    expect(h.step().outputs.tilt).toEqual([0, 0, 0]);
    sample = undefined;
    const held = h.step();
    expect(held.outputs.available).toBe(true);
    expect(held.outputs.acceleration).toEqual([0, 0, -1]);
  });

  it("holds the last values and reports Available false while disabled", () => {
    const h = createPatchHarness(deviceMotionPatch, { services: { platform: { deviceMotion: () => ({ acceleration: [0.5, 0, -0.5], rotationRate: [4, 5, 6], attitude: [1, 2, 3] }) } } });
    h.step();
    const f = h.step({ inputs: { enabled: false } });
    expect(f.outputs).toEqual({ tilt: [1, 2, 3], acceleration: [0.5, 0, -0.5], rotationRate: [4, 5, 6], available: false });
    expect(f.requestedNextFrame).toBe(false);
  });

  it("outputs 0 for non-finite components and warns once per restart", () => {
    const h = createPatchHarness(deviceMotionPatch, { services: { platform: { deviceMotion: () => ({ acceleration: [Number.NaN, -1, 0], rotationRate: [Number.POSITIVE_INFINITY, 0, 0], attitude: [0, 0, 0] }) } } });
    const f = h.run(4);
    expect(f.outputs.acceleration).toEqual([0, -1, 0]);
    expect(f.outputs.rotationRate).toEqual([0, 0, 0]);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("keeps one state per loop index", () => {
    const sample: DeviceMotionSample = { acceleration: [0, -1, 0], rotationRate: [0, 0, 0] };
    const h = createPatchHarness(deviceMotionPatch, { inputs: { enabled: loopOf([true, false]) }, services: { platform: { deviceMotion: () => sample as never } } });
    const f = h.step();
    expect(f.outputs.available).toEqual(loopOf([true, false]));
    expect(f.outputs.tilt).toEqual(loopOf([[90, 0, 0], [0, 0, 0]]));
  });

  it("outputs zero values while muted", () => {
    const result = runPatch(deviceMotionPatch, [{ enabled: true }], { muted: true });
    expect(result.frames[0]!.outputs).toEqual({ tilt: [0, 0, 0], acceleration: [0, 0, 0], rotationRate: [0, 0, 0], available: false });
  });
});
