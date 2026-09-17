import type { Loop } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { springConverter } from "./springConverter.ts";

describe("springConverter", () => {
  it.each([
    [0.55, 0.825, 130.5072, 18.8496, -0.562, 2.0384],
    [0.5, 0.825, 157.9137, 20.7345, 1.7586, 3.3287],
    [0.3629906, 0.7813254, 299.6187, 27.0487, 5, 10],
    [0.5, 1, 157.9137, 25.1327, -2.5595, 3.3287],
    [0.5, 0, 157.9137, 0, 42.5, 3.3287],
    [1.0, 0.825, 39.4784, 10.3673, -31.4672, 0],
  ])("converts response %d, damping fraction %d", (response, dampingFraction, tension, friction, bounciness, speed) => {
    const h = createPatchHarness(springConverter, { inputs: { response, dampingFraction } });
    const out = h.step().outputs;
    expect(out.mass).toBe(1);
    expect(out.tension as number).toBeCloseTo(tension, 3);
    expect(out.friction as number).toBeCloseTo(friction, 3);
    expect(out.bounciness as number).toBeCloseTo(bounciness, 3);
    expect(out.speed as number).toBeCloseTo(speed, 3);
    expect(h.logs).toHaveLength(0);
  });

  it("defaults to Spring Animation's default spring", () => {
    const out = createPatchHarness(springConverter).step().outputs;
    expect(out.tension as number).toBeCloseTo(130.51, 2);
    expect(out.friction as number).toBeCloseTo(18.85, 2);
  });

  it("treats Response ≤ 0 as 0.01 s and warns once", () => {
    const h = createPatchHarness(springConverter, { inputs: { response: 0 } });
    const out = h.run(3).outputs;
    expect(out.tension as number).toBeCloseTo((2 * Math.PI / 0.01) ** 2, 6);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    for (const value of Object.values(out)) expect(Number.isFinite(value)).toBe(true);
  });

  it("clamps Damping Fraction to 0–2", () => {
    const at = (dampingFraction: number) => createPatchHarness(springConverter, { inputs: { dampingFraction } }).step().outputs.friction;
    expect(at(-1)).toBe(at(0));
    expect(at(5)).toBe(at(2));
  });

  it("evaluates loops per index", () => {
    const out = createPatchHarness(springConverter, { inputs: { response: loopOf([0.5, 1]) } }).step().outputs;
    expect((out.tension as Loop<number>).items).toHaveLength(2);
  });
});
