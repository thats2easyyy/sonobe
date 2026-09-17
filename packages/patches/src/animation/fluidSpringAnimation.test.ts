import { createVectorSpringState, fromResponseDampingFraction, setVectorSpringTarget, stepVectorSpring } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import { createPatchHarness, springConverterValues } from "../infra/index.ts";
import { fluidSpringAnimation } from "./fluidSpringAnimation.ts";

describe("fluidSpringAnimation", () => {
  it.each([60, 120] as const)("matches the catalog golden step response at %i fps", (fps) => {
    const h = createPatchHarness(fluidSpringAnimation, { fps, inputs: { number: 0, response: 0.5, dampingFraction: 0.825 } });
    expect(h.step().outputs.output).toBe(0);
    const samples: Record<string, number> = {};
    let peak = 0;
    let rest: number | null = null;
    for (let i = 1; i <= fps * 2; i++) {
      const frame = h.step({ inputs: { number: 1 } });
      const value = frame.outputs.output as number;
      if (i === fps / 10) samples["0.1"] = value;
      if (i === fps / 4) samples["0.25"] = value;
      if (i === fps / 2) samples["0.5"] = value;
      peak = Math.max(peak, value);
      if (rest === null && !frame.requestedNextFrame) rest = i / fps;
    }
    expect(samples["0.1"]).toBeCloseTo(0.3936, 3);
    expect(samples["0.25"]).toBeCloseTo(0.9082, 3);
    expect(samples["0.5"]).toBeCloseTo(1.0084, 3);
    expect(peak).toBeCloseTo(1.0101, 3);
    expect(rest).not.toBeNull();
    expect(rest!).toBeCloseTo(0.85, 1);
    expect(h.output("output")).toBe(1);
  });

  it("uses the same k and c as Spring Converter and the engine", () => {
    const config = fromResponseDampingFraction(0.4, 0.6);
    const converted = springConverterValues(0.4, 0.6);
    expect(config.stiffness).toBe(converted.tension);
    expect(config.damping).toBe(converted.friction);
    const h = createPatchHarness(fluidSpringAnimation, { inputs: { number: 0, response: 0.4, dampingFraction: 0.6 } });
    h.step();
    const reference = createVectorSpringState([0]);
    setVectorSpringTarget(reference, [10]);
    for (let i = 0; i < 30; i++) {
      h.step({ inputs: { number: 10 } });
      stepVectorSpring(reference, config, 1 / 60);
    }
    expect(h.output("output")).toBe(reference.value[0]);
  });

  it("tracks while Gesture Active and flings from the last tracked position", () => {
    const config = fromResponseDampingFraction(0.55, 0.825);
    const h = createPatchHarness(fluidSpringAnimation, { typeParam: "point", inputs: { number: [0, 0], gestureActive: true } });
    h.step();
    expect(h.step({ inputs: { number: [40, 80] } }).outputs.output).toEqual([40, 80]);
    const reference = createVectorSpringState([40, 80], [0, 0], [-500, 250]);
    stepVectorSpring(reference, config, 1 / 60);
    const frame = h.step({ inputs: { number: [0, 0], gestureActive: false, gestureVelocity: [-500, 250] } });
    expect(frame.outputs.output).toEqual(reference.value);
    expect(frame.requestedNextFrame).toBe(true);
  });

  it("treats Response ≤ 0 as 0.01 s and warns once", () => {
    const run = (response: number) => {
      const h = createPatchHarness(fluidSpringAnimation, { inputs: { number: 0, response } });
      h.step();
      return { value: h.run(3, { inputs: { number: 1 } }).outputs.output, warnings: h.logs.filter((l) => l.level === "warn").length };
    };
    const clamped = run(0);
    expect(clamped.value).toBe(run(0.01).value);
    expect(clamped.warnings).toBe(1);
  });

  it("clamps Damping Fraction to 0–2", () => {
    const run = (dampingFraction: number) => {
      const h = createPatchHarness(fluidSpringAnimation, { inputs: { number: 0, dampingFraction } });
      h.step();
      return h.run(10, { inputs: { number: 1 } }).outputs.output;
    };
    expect(run(-1)).toBe(run(0));
    expect(run(9)).toBe(run(2));
  });

  it("keeps oscillating with Damping Fraction 0", () => {
    const h = createPatchHarness(fluidSpringAnimation, { inputs: { number: 0, dampingFraction: 0 } });
    h.step();
    expect(h.run(600, { inputs: { number: 1 } }).requestedNextFrame).toBe(true);
  });
});
