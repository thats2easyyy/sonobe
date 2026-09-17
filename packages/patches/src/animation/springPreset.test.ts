import { SPRING_PRESETS, fromBouncinessSpeed, fromDurationBounce } from "@sonobe/engine";
import type { Loop } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { bouncyConverterValues, createPatchHarness, loopOf } from "../infra/index.ts";
import { springPreset } from "./springPreset.ts";

const outputs = (inputs: Record<string, unknown>) => createPatchHarness(springPreset, { inputs }).step().outputs;

describe("springPreset", () => {
  it.each([
    ["smooth", 157.91, 25.13, 1, -2.56, 3.33, 0.5],
    ["snappy", 438.65, 35.6, 0.85, 3.39, 16.55, 0.3],
    ["bouncy", 157.91, 17.59, 0.7, 5.15, 3.33, 0.5],
    ["gentle", 70.18, 15.08, 0.9, -34.99, 0, 0.75],
  ] as const)("outputs the %s feel", (preset, tension, friction, dampingFraction, bounciness, speed, response) => {
    const out = outputs({ preset });
    expect(out.mass).toBe(1);
    expect(out.tension as number).toBeCloseTo(tension, 2);
    expect(out.friction as number).toBeCloseTo(friction, 2);
    expect(out.dampingFraction as number).toBeCloseTo(dampingFraction, 9);
    expect(out.bounciness as number).toBeCloseTo(bounciness, 2);
    expect(out.speed as number).toBeCloseTo(speed, 2);
    expect(out.response).toBe(response);
  });

  it("agrees with the engine's presets and fromDurationBounce", () => {
    for (const p of SPRING_PRESETS) {
      const out = outputs({ preset: p.key });
      const config = fromDurationBounce(p.duration, p.bounce);
      expect(out.tension as number).toBeCloseTo(config.stiffness, 9);
      expect(out.friction as number).toBeCloseTo(config.damping, 9);
    }
  });

  it("round-trips exact Pop equivalents through Pop Animation's spring", () => {
    const out = outputs({ preset: "bouncy" });
    const pop = fromBouncinessSpeed(out.bounciness as number, out.speed as number);
    expect(pop.stiffness).toBeCloseTo(out.tension as number, 4);
    expect(pop.damping).toBeCloseTo(out.friction as number, 4);
  });

  it("gives Gentle the closest Pop spring", () => {
    const out = outputs({ preset: "gentle" });
    const converted = bouncyConverterValues(out.bounciness as number, out.speed as number);
    expect(converted.tension).toBeCloseTo(87.21, 2);
    expect(converted.friction).toBeCloseTo(16.81, 2);
  });

  it("uses Duration and Bounce only for Custom", () => {
    expect(outputs({ preset: "smooth", duration: 2, bounce: 0.5 })).toEqual(outputs({ preset: "smooth" }));
    const custom = outputs({ preset: "custom", duration: 0.4, bounce: -0.5 });
    expect(custom.response).toBe(0.4);
    expect(custom.dampingFraction).toBe(2);
    expect(custom.tension as number).toBeCloseTo((2 * Math.PI / 0.4) ** 2, 9);
    expect(custom.friction as number).toBeCloseTo((4 * Math.PI * 2) / 0.4, 9);
  });

  it("clamps Custom Duration and Bounce", () => {
    expect(outputs({ preset: "custom", duration: -1 }).response).toBe(0.01);
    expect(outputs({ preset: "custom", duration: Number.NaN }).response).toBe(0.5);
    const out = outputs({ preset: "custom", bounce: 1 });
    expect(out.dampingFraction as number).toBeGreaterThan(0);
    expect(Number.isFinite(out.bounciness)).toBe(true);
  });

  it("treats an unknown preset as Smooth", () => {
    expect(outputs({ preset: "floaty" })).toEqual(outputs({ preset: "smooth" }));
  });

  it("evaluates a loop of presets per index", () => {
    const out = outputs({ preset: loopOf(["smooth", "snappy"]) });
    expect((out.response as Loop<number>).items).toEqual([0.5, 0.3]);
  });

  it("outputs the Smooth preset while muted", () => {
    const result = runPatch(springPreset, [{ preset: "snappy", duration: 3 }], { muted: true });
    const smooth = outputs({ preset: "smooth" });
    expect(result.frames[0]!.outputs).toEqual(smooth);
  });
});
