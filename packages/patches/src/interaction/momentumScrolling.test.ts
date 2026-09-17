import { describe, expect, it } from "vitest";
import { decayPosition, decayVelocity } from "@sonobe/engine";
import type { HarnessFrame } from "../infra/index.ts";
import { loopOf } from "../infra/index.ts";
import { momentumScrolling, scrollingDeceleration } from "./momentumScrolling.ts";
import { createInteractionRig, type InteractionRig } from "./testing.ts";

function settle(r: InteractionRig<unknown>): HarnessFrame {
  let f = r.step();
  for (let i = 0; i < 900 && f.outputs.moving === true; i++) f = r.step();
  return f;
}

/** Track `value` rising by `perFrame` for `frames` frames after one grab frame. */
function track(r: InteractionRig<unknown>, from: number, perFrame: number, frames: number): HarnessFrame {
  let f = r.step({ inputs: { tracking: true, value: from } });
  for (let i = 1; i <= frames; i++) f = r.step({ inputs: { value: from + perFrame * i } });
  return f;
}

describe("scrollingDeceleration", () => {
  it("anchors the legacy default to POP's normal rate", () => {
    expect(scrollingDeceleration(4)).toBeCloseTo(0.998, 12);
    expect(scrollingDeceleration(20)).toBeCloseTo(0.99, 12);
    expect(scrollingDeceleration(100)).toBeCloseTo(0.95, 12);
    expect(scrollingDeceleration(500)).toBeCloseTo(0.95, 12);
    expect(scrollingDeceleration(0)).toBeCloseTo(0.9995, 12);
  });
});

describe("momentumScrolling", () => {
  it("starts at Value clamped to the boundaries", () => {
    const r = createInteractionRig(momentumScrolling, { inputs: { value: -50 } });
    expect(r.step().outputs).toEqual({ output: 0, velocity: 0, moving: false });
    const swapped = createInteractionRig(momentumScrolling, { inputs: { value: 150, startBoundary: 100, endBoundary: 0 } });
    expect(swapped.step().outputs.output).toBe(100);
    const tracking = createInteractionRig(momentumScrolling, { inputs: { value: -50, tracking: true } });
    expect(tracking.step().outputs.output).toBe(-50);
  });

  it("follows Value while tracking with a smoothed velocity and no grab spike", () => {
    const r = createInteractionRig(momentumScrolling);
    r.step();
    const grab = r.step({ inputs: { tracking: true, value: 500 } });
    expect(grab.outputs).toEqual({ output: 500, velocity: 0, moving: false });
    let expected = 0;
    let f = grab;
    for (let i = 1; i <= 10; i++) {
      f = r.step({ inputs: { value: 500 + 10 * i } });
      expected += (600 - expected) * (1 - Math.exp(-1 / 60 / 0.03));
    }
    expect(f.outputs.output).toBe(600);
    expect(f.outputs.velocity).toBeCloseTo(expected, 9);
  });

  it("coasts with POP decay after release and comes to rest", () => {
    const r = createInteractionRig(momentumScrolling);
    r.step();
    const last = track(r, 0, 10, 10);
    const v = last.outputs.velocity as number;
    const release = r.step({ inputs: { tracking: false } });
    expect(release.outputs.moving).toBe(true);
    expect(release.outputs.output).toBeCloseTo(100 + decayPosition(0, v, 0.998, 1 / 60), 9);
    expect(release.outputs.velocity).toBeCloseTo(decayVelocity(v, 0.998, 1 / 60), 9);
    expect(release.requestedNextFrame).toBe(true);
    const rest = settle(r);
    expect(rest.outputs.velocity).toBe(0);
    expect(rest.outputs.output as number).toBeGreaterThan(300);
  });

  it("catches a coasting value immediately", () => {
    const r = createInteractionRig(momentumScrolling);
    r.step();
    track(r, 0, 10, 10);
    r.step({ inputs: { tracking: false } });
    r.run(5);
    expect(r.step({ inputs: { tracking: true, value: 5000 } }).outputs).toEqual({ output: 5000, velocity: 0, moving: false });
  });

  it("springs back into range after releasing past a boundary", () => {
    const r = createInteractionRig(momentumScrolling, { inputs: { endBoundary: 400 } });
    r.step();
    track(r, 0, -20, 10);
    const release = r.step({ inputs: { tracking: false } });
    expect(release.outputs.moving).toBe(true);
    const rest = settle(r);
    expect(rest.outputs).toEqual({ output: 0, velocity: 0, moving: false });
  });

  it("stops at the boundaries with Stick to Boundaries on", () => {
    const r = createInteractionRig(momentumScrolling, { inputs: { endBoundary: 150, stickToBoundaries: true } });
    r.step();
    const tracking = track(r, 100, 20, 5);
    expect(tracking.outputs.output).toBe(150);
    const rest = settle(r.step({ inputs: { tracking: false } }) && r);
    expect(rest.outputs.output).toBe(150);
  });

  it("pins Output to equal boundaries after release", () => {
    const r = createInteractionRig(momentumScrolling, { inputs: { startBoundary: 50, endBoundary: 50 } });
    r.step();
    track(r, 0, 30, 5);
    r.step({ inputs: { tracking: false } });
    expect(settle(r).outputs.output).toBe(50);
  });

  it("passes a Tracking pulse as a one-frame sample with no fling", () => {
    const r = createInteractionRig(momentumScrolling);
    r.step();
    r.step({ inputs: { tracking: true, value: 80 } });
    const release = r.step({ inputs: { tracking: false } });
    expect(release.outputs).toEqual({ output: 80, velocity: 0, moving: false });
  });

  it("treats non-finite inputs as 0 and warns once", () => {
    const r = createInteractionRig(momentumScrolling, { inputs: { value: Number.POSITIVE_INFINITY } });
    expect(r.step().outputs.output).toBe(0);
    r.step();
    expect(r.harness.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("keeps per-index state", () => {
    const r = createInteractionRig(momentumScrolling, { inputs: { value: loopOf([0, 200]) } });
    expect(r.step().outputs.output).toEqual(loopOf([0, 200]));
  });
});
