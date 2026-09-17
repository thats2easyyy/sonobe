import { SPRING_PRESETS, fromBouncinessSpeed, fromDurationBounce } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import {
  POP_MIN_DAMPING,
  POP_MIN_STIFFNESS,
  bouncyConverterValues,
  fluidSpringConfig,
  popCompatible,
  popSpringConfig,
  springConverterValues,
  springPresetValues,
  trackSpringTarget,
} from "./springs.ts";

describe("springConverterValues", () => {
  // Golden values from the springConverter catalog behavior: response, dampingFraction → tension, friction, bounciness, speed.
  it.each([
    [0.55, 0.825, 130.5072, 18.8496, -0.562, 2.0384],
    [0.5, 0.825, 157.9137, 20.7345, 1.7586, 3.3287],
    [0.3629906, 0.7813254, 299.6187, 27.0487, 5, 10],
    [0.5, 1, 157.9137, 25.1327, -2.5595, 3.3287],
    [0.5, 0, 157.9137, 0, 42.5, 3.3287],
    [1.0, 0.825, 39.4784, 10.3673, -31.4672, 0],
  ])("response %d, damping fraction %d", (response, dampingFraction, tension, friction, bounciness, speed) => {
    const v = springConverterValues(response, dampingFraction);
    expect(v.mass).toBe(1);
    expect(v.tension).toBeCloseTo(tension, 3);
    expect(v.friction).toBeCloseTo(friction, 3);
    expect(v.bounciness).toBeCloseTo(bounciness, 3);
    expect(v.speed).toBeCloseTo(speed, 3);
  });

  it("clamps Response and Damping Fraction like Fluid Spring Animation", () => {
    const config = fluidSpringConfig(0, 3);
    expect(config.stiffness).toBeCloseTo((2 * Math.PI / 0.01) ** 2, 3);
    expect(config.damping).toBeCloseTo((4 * Math.PI * 2) / 0.01, 3);
    expect(fluidSpringConfig(0.5, 0.825).stiffness).toBeCloseTo(157.9137, 3);
    expect(fluidSpringConfig(0.5, 0.825).damping).toBeCloseTo(20.7345, 3);
    expect(springConverterValues(-1, -1)).toEqual(springConverterValues(0.01, 0));
  });
});

describe("springPresetValues", () => {
  // Preset golden values from the springPreset catalog behavior: k, c, ζ → Bounciness, Speed.
  it.each([
    ["smooth", 157.91, 25.13, 1, -2.56, 3.33],
    ["snappy", 438.65, 35.6, 0.85, 3.39, 16.55],
    ["bouncy", 157.91, 17.59, 0.7, 5.15, 3.33],
    ["gentle", 70.18, 15.08, 0.9, -34.99, 0],
  ] as const)("%s", (preset, tension, friction, dampingFraction, bounciness, speed) => {
    const v = springPresetValues(preset);
    expect(v.tension).toBeCloseTo(tension, 2);
    expect(v.friction).toBeCloseTo(friction, 2);
    expect(v.dampingFraction).toBeCloseTo(dampingFraction, 9);
    expect(v.bounciness).toBeCloseTo(bounciness, 2);
    expect(v.speed).toBeCloseTo(speed, 2);
  });

  it("agrees with the engine presets and fromDurationBounce", () => {
    for (const p of SPRING_PRESETS) {
      const v = springPresetValues(p.key);
      const config = fromDurationBounce(p.duration, p.bounce);
      expect(v.response).toBe(p.duration);
      expect(v.tension).toBeCloseTo(config.stiffness, 9);
      expect(v.friction).toBeCloseTo(config.damping, 9);
    }
  });

  it("handles Custom and unknown presets", () => {
    expect(springPresetValues("wobbly")).toEqual(springPresetValues("smooth"));
    const custom = springPresetValues("custom", 0, 2);
    expect(custom.response).toBe(0.01);
    expect(custom.dampingFraction).toBeCloseTo(1e-6, 9);
    expect(springPresetValues("custom", Number.NaN, Number.NaN)).toEqual(springPresetValues("custom", 0.5, 0));
    expect(springPresetValues("custom", 0.5, 0)).toEqual(springPresetValues("smooth"));
    const overdamped = springPresetValues("custom", 0.5, -0.5);
    expect(overdamped.dampingFraction).toBe(2);
  });
});

describe("popCompatible", () => {
  it("maps springs Pop can make back exactly", () => {
    const config = fromBouncinessSpeed(8, 14);
    const zeta = config.damping / (2 * Math.sqrt(config.stiffness));
    const pop = popCompatible(config.stiffness, config.damping, zeta);
    expect(pop.bounciness).toBeCloseTo(8, 6);
    expect(pop.speed).toBeCloseTo(14, 6);
  });

  it("falls back to the closest Pop spring", () => {
    const gentle = springPresetValues("gentle");
    const back = fromBouncinessSpeed(gentle.bounciness, gentle.speed);
    expect(back.stiffness).toBeCloseTo(POP_MIN_STIFFNESS, 6);
    expect(back.damping).toBeCloseTo(2 * 0.9 * Math.sqrt(POP_MIN_STIFFNESS), 6);
    const undamped = popCompatible(157.9137, 0, 0);
    expect(fromBouncinessSpeed(undamped.bounciness, undamped.speed).damping).toBeCloseTo(POP_MIN_DAMPING, 6);
  });
});

describe("Pop springs", () => {
  // Golden values from the bouncyConverter catalog behavior: bounciness, speed → tension, friction.
  it.each([
    [5, 10, 299.6188, 27.0487],
    [0, 10, 299.6188, 34.4496],
    [10, 10, 299.6188, 20.5729],
    [0, 0, 87.21, 5.777],
    [4, 12, 342.1006, 30.487],
  ])("bounciness %d, speed %d", (bounciness, speed, tension, friction) => {
    const v = bouncyConverterValues(bounciness, speed);
    expect(v.tension).toBeCloseTo(tension, 3);
    expect(v.friction).toBeCloseTo(friction, 3);
  });

  it("clamps Pop inputs", () => {
    expect(bouncyConverterValues(3, -5)).toEqual(bouncyConverterValues(3, 0));
    expect(popSpringConfig(Number.NaN, 10)).toEqual(fromBouncinessSpeed(5, 10));
    expect(popSpringConfig(5, Number.NaN)).toEqual(fromBouncinessSpeed(5, 0));
  });
});

describe("trackSpringTarget", () => {
  it("creates, retargets with velocity, and restarts on dimension changes", () => {
    const s = trackSpringTarget(null, [1, 2]);
    expect(s.value).toEqual([1, 2]);
    expect(s.velocity).toEqual([0, 0]);
    s.velocity = [3, 4];
    expect(trackSpringTarget(s, [5, 6])).toBe(s);
    expect(s.target).toEqual([5, 6]);
    expect(s.velocity).toEqual([3, 4]);
    expect(s.value).toEqual([1, 2]);
    const restarted = trackSpringTarget(s, [7]);
    expect(restarted).not.toBe(s);
    expect(restarted.value).toEqual([7]);
    expect(restarted.velocity).toEqual([0]);
  });
});
