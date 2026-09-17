import { createVectorSpringState, setVectorSpringTarget, stepVectorSpring } from "@sonobe/engine";
import type { Loop, SpringConfig } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { springAnimation } from "./springAnimation.ts";

const DEFAULT_SPRING: SpringConfig = { mass: 1, stiffness: 130.51, damping: 18.85 };
const warnings = (logs: readonly { level: string }[]) => logs.filter((l) => l.level === "warn");

describe("springAnimation", () => {
  it("starts at rest on the first Number", () => {
    const h = createPatchHarness(springAnimation, { inputs: { number: 12 } });
    const frame = h.step();
    expect(frame.outputs.output).toBe(12);
    expect(frame.requestedNextFrame).toBe(false);
  });

  it("follows the engine spring for Mass, Tension, and Friction", () => {
    const config: SpringConfig = { mass: 2, stiffness: 200, damping: 10 };
    const h = createPatchHarness(springAnimation, { inputs: { number: 0, mass: 2, tension: 200, friction: 10 } });
    h.step();
    const reference = createVectorSpringState([0]);
    setVectorSpringTarget(reference, [1]);
    for (let i = 0; i < 60; i++) {
      const frame = h.step({ inputs: { number: 1 } });
      stepVectorSpring(reference, config, 1 / 60);
      expect(frame.outputs.output).toBe(reference.value[0]);
    }
  });

  it("defaults to SwiftUI's spring(response: 0.55, dampingFraction: 0.825): about 1% overshoot, settled in about 0.93 s", () => {
    const h = createPatchHarness(springAnimation, { inputs: { number: 0 } });
    h.step();
    let peak = 0;
    let settled: number | null = null;
    for (let i = 1; i <= 120; i++) {
      const frame = h.step({ inputs: { number: 1 } });
      peak = Math.max(peak, frame.outputs.output as number);
      if (settled === null && !frame.requestedNextFrame) settled = i / 60;
    }
    expect(peak).toBeGreaterThan(1.005);
    expect(peak).toBeLessThan(1.02);
    expect(settled).not.toBeNull();
    expect(settled!).toBeGreaterThan(0.75);
    expect(settled!).toBeLessThan(1.1);
    expect(h.output("output")).toBe(1);
  });

  it("tracks Number while Gesture Active, then flings with Gesture Velocity on release", () => {
    const h = createPatchHarness(springAnimation, { inputs: { number: 0, gestureActive: true } });
    h.step();
    for (const x of [10, 20, 35, 50]) expect(h.step({ inputs: { number: x, gestureVelocity: 400 } }).outputs.output).toBe(x);
    const reference = createVectorSpringState([50], [0], [1000]);
    stepVectorSpring(reference, DEFAULT_SPRING, 1 / 60);
    const release = h.step({ inputs: { number: 0, gestureActive: false, gestureVelocity: 1000 } });
    expect(release.outputs.output).toBe(reference.value[0]);
    expect(release.outputs.output as number).toBeGreaterThan(50);
    // Gesture Velocity only matters on the release frame.
    stepVectorSpring(reference, DEFAULT_SPRING, 1 / 60);
    expect(h.step({ inputs: { gestureVelocity: -99999 } }).outputs.output).toBe(reference.value[0]);
  });

  it("doesn't fling on the first frame when Gesture Active starts off", () => {
    const h = createPatchHarness(springAnimation, { inputs: { number: 5, gestureActive: false, gestureVelocity: 800 } });
    h.step();
    expect(h.run(5).outputs.output).toBe(5);
  });

  it("hands each component its own gesture velocity", () => {
    const h = createPatchHarness(springAnimation, { typeParam: "point", inputs: { number: [100, 100], gestureActive: true } });
    h.step();
    const reference = createVectorSpringState([100, 100], [100, 100], [300, -200]);
    stepVectorSpring(reference, DEFAULT_SPRING, 1 / 60);
    const frame = h.step({ inputs: { gestureActive: false, gestureVelocity: [300, -200] } });
    expect(frame.outputs.output).toEqual(reference.value);
  });

  it("coasts with Tension 0 and stops where friction brings it to rest", () => {
    const h = createPatchHarness(springAnimation, { inputs: { number: 0, tension: 0, friction: 10, gestureActive: true } });
    h.step();
    h.step({ inputs: { gestureActive: false, gestureVelocity: 100 } });
    const frame = h.run(600);
    expect(frame.requestedNextFrame).toBe(false);
    expect(frame.outputs.output as number).toBeCloseTo(10, 2);
  });

  it("treats Mass ≤ 0 as 0.01 and negative Tension or Friction as 0", () => {
    const h = createPatchHarness(springAnimation, { inputs: { number: 0, mass: -3, tension: 100, friction: -5 } });
    h.step();
    const reference = createVectorSpringState([0]);
    setVectorSpringTarget(reference, [1]);
    for (let i = 0; i < 10; i++) {
      h.step({ inputs: { number: 1 } });
      stepVectorSpring(reference, { mass: 0.01, stiffness: 100, damping: 0 }, 1 / 60);
    }
    expect(h.output("output")).toBe(reference.value[0]);
    expect(warnings(h.logs)).toHaveLength(0);
  });

  it("falls back to the default spring for non-finite constants and warns once", () => {
    const h = createPatchHarness(springAnimation, { inputs: { number: 0, tension: Number.NaN } });
    h.step();
    const reference = createVectorSpringState([0]);
    setVectorSpringTarget(reference, [1]);
    for (let i = 0; i < 10; i++) {
      h.step({ inputs: { number: 1 } });
      stepVectorSpring(reference, DEFAULT_SPRING, 1 / 60);
    }
    expect(h.output("output")).toBe(reference.value[0]);
    expect(warnings(h.logs)).toHaveLength(1);
  });

  it("snaps to its target when the spring is too stiff to integrate", () => {
    const h = createPatchHarness(springAnimation, { inputs: { number: 0, mass: 0.01, tension: 1e12 } });
    h.step();
    const frame = h.step({ inputs: { number: 7 } });
    expect(frame.outputs.output).toBe(7);
    expect(frame.requestedNextFrame).toBe(false);
    expect(warnings(h.logs)).toHaveLength(1);
  });

  it("keeps per-index springs for loops", () => {
    const h = createPatchHarness(springAnimation, { inputs: { number: loopOf([0, 5]) } });
    h.step();
    h.step({ inputs: { number: loopOf([0, 6]) } });
    const items = (h.output("output") as Loop<number>).items;
    expect(items[0]).toBe(0);
    expect(items[1]).toBeGreaterThan(5);
    expect(items[1]).toBeLessThan(6);
  });
});
