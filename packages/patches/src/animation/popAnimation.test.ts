import type { Color } from "@sonobe/core";
import { createVectorSpringState, fromBouncinessSpeed, setVectorSpringTarget, stepVectorSpring } from "@sonobe/engine";
import type { Loop } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { popAnimation } from "./popAnimation.ts";

const warnings = (logs: readonly { level: string }[]) => logs.filter((l) => l.level === "warn");

describe("popAnimation", () => {
  it("starts at rest on the first Number instead of animating from 0", () => {
    const h = createPatchHarness(popAnimation, { inputs: { number: 5 } });
    const first = h.step();
    expect(first.outputs.output).toBe(5);
    expect(first.requestedNextFrame).toBe(false);
    expect(h.run(10).outputs.output).toBe(5);
  });

  it("follows the engine's Rebound spring exactly for Bounciness 5 and Speed 10", () => {
    const config = fromBouncinessSpeed(5, 10);
    expect(config.stiffness).toBeCloseTo(299.62, 2);
    expect(config.damping).toBeCloseTo(27.05, 2);
    const h = createPatchHarness(popAnimation, { inputs: { number: 0 } });
    h.step();
    const reference = createVectorSpringState([0]);
    setVectorSpringTarget(reference, [1]);
    let peak = 0;
    for (let i = 0; i < 90; i++) {
      const frame = h.step({ inputs: { number: 1 } });
      stepVectorSpring(reference, config, 1 / 60);
      expect(frame.outputs.output).toBe(reference.value[0]);
      if (i === 0) expect(frame.requestedNextFrame).toBe(true);
      peak = Math.max(peak, frame.outputs.output as number);
    }
    expect(peak).toBeGreaterThan(1.01);
    expect(h.output("output")).toBe(1);
    expect(h.step().requestedNextFrame).toBe(false);
  });

  it("keeps position and velocity when the target changes mid-flight", () => {
    const config = fromBouncinessSpeed(5, 10);
    const h = createPatchHarness(popAnimation, { inputs: { number: 0 } });
    h.step();
    const reference = createVectorSpringState([0]);
    setVectorSpringTarget(reference, [100]);
    for (let i = 0; i < 8; i++) {
      h.step({ inputs: { number: 100 } });
      stepVectorSpring(reference, config, 1 / 60);
    }
    expect(h.state()!.spring!.velocity[0]).toBeGreaterThan(100);
    setVectorSpringTarget(reference, [-50]);
    stepVectorSpring(reference, config, 1 / 60);
    const frame = h.step({ inputs: { number: -50 } });
    expect(frame.outputs.output).toBe(reference.value[0]);
    expect(h.state()!.spring!.velocity[0]).toBe(reference.velocity[0]);
  });

  it("gives the same motion at 60 and 120 fps", () => {
    const sample = (fps: 60 | 120) => {
      const h = createPatchHarness(popAnimation, { fps, inputs: { number: 0, bounciness: 12, speed: 14 } });
      h.step();
      const out: number[] = [];
      for (let i = 1; i <= fps; i++) {
        h.step({ inputs: { number: 1 } });
        if (i % (fps / 20) === 0) out.push(h.output("output") as number);
      }
      return out;
    };
    const at60 = sample(60);
    const at120 = sample(120);
    at60.forEach((v, i) => expect(v).toBeCloseTo(at120[i]!, 6));
  });

  it("treats a negative Speed as 0 and a non-finite Bounciness as 5", () => {
    const run = (inputs: Record<string, unknown>) => {
      const h = createPatchHarness(popAnimation, { inputs: { number: 0, ...inputs } });
      h.step();
      return h.run(12, { inputs: { number: 1 } }).outputs.output;
    };
    expect(run({ bounciness: 5, speed: -4 })).toBe(run({ bounciness: 5, speed: 0 }));
    expect(run({ bounciness: Number.NaN, speed: 10 })).toBe(run({ bounciness: 5, speed: 10 }));
  });

  it("springs each component of a point", () => {
    const config = fromBouncinessSpeed(5, 10);
    const h = createPatchHarness(popAnimation, { typeParam: "point", inputs: { number: [0, 0] } });
    expect(h.step().outputs.output).toEqual([0, 0]);
    const reference = createVectorSpringState([0, 0]);
    setVectorSpringTarget(reference, [100, -40]);
    for (let i = 0; i < 20; i++) {
      h.step({ inputs: { number: [100, -40] } });
      stepVectorSpring(reference, config, 1 / 60);
    }
    expect(h.output("output")).toEqual(reference.value);
  });

  it("clamps color channels in the output while the spring overshoots internally", () => {
    const black: Color = { r: 0, g: 0, b: 0, a: 1 };
    const white: Color = { r: 1, g: 1, b: 1, a: 1 };
    const h = createPatchHarness(popAnimation, { typeParam: "color", inputs: { number: black, bounciness: 20, speed: 20 } });
    expect(h.step().outputs.output).toEqual(black);
    let overshoot = false;
    for (let i = 0; i < 60; i++) {
      const color = h.step({ inputs: { number: white } }).outputs.output as Color;
      expect(color.r).toBeLessThanOrEqual(1);
      expect(color.r).toBeGreaterThanOrEqual(0);
      if (h.state()!.spring!.value[0]! > 1) overshoot = true;
    }
    expect(overshoot).toBe(true);
  });

  it("keeps a spring per loop index, and new indices start at rest on their own target", () => {
    const h = createPatchHarness(popAnimation, { inputs: { number: loopOf([0, 10]) } });
    expect(h.step().outputs.output).toEqual(loopOf([0, 10]));
    h.step({ inputs: { number: loopOf([1, 10, 20]) } });
    const items = (h.output("output") as Loop<number>).items;
    expect(items[0]).toBeGreaterThan(0);
    expect(items[0]).toBeLessThan(1);
    expect(items[1]).toBe(10);
    expect(items[2]).toBe(20);
  });

  it("keeps the previous target when Number isn't finite and warns once", () => {
    const h = createPatchHarness(popAnimation, { inputs: { number: 3 } });
    h.step();
    expect(h.run(5, { inputs: { number: Number.POSITIVE_INFINITY } }).outputs.output).toBe(3);
    expect(warnings(h.logs)).toHaveLength(1);
  });

  it("restarts at rest on the current Number", () => {
    const h = createPatchHarness(popAnimation, { inputs: { number: 0 } });
    h.step();
    h.run(3, { inputs: { number: 50 } });
    h.restart();
    expect(h.step().outputs.output).toBe(50);
  });

  it("passes Number through while muted", () => {
    const result = runPatch(popAnimation, [{ number: 4 }, { number: 8 }], { muted: true });
    expect(result.frames.map((f) => f.outputs.output)).toEqual([4, 8]);
  });
});
