import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { sine, sineDegrees } from "./sine.ts";

describe("sine", () => {
  it("is exact at common angles in degrees", () => {
    expect([0, 30, 90, 180, 270, 360].map(sineDegrees)).toEqual([0, 0.5, 1, 0, -1, 0]);
    expect(Object.is(sineDegrees(-180), 0)).toBe(true);
    expect(sineDegrees(45)).toBe(0.707106781187);
  });

  it("stays accurate for huge angles", () => {
    expect(sineDegrees(360 * 1e6 + 30)).toBe(0.5);
  });

  it("outputs 0 for a non-finite angle and warns once per restart", () => {
    const h = createPatchHarness(sine, { inputs: { angle: Number.POSITIVE_INFINITY } });
    expect(h.run(2).outputs.output).toBe(0);
    expect(h.logs.map((l) => l.message)).toEqual(["patch_1: Angle isn't a finite number, so Sine outputs 0"]);
    h.restart();
    h.step();
    expect(h.logs).toHaveLength(2);
  });

  it("evaluates once per loop index", () => {
    expect(createPatchHarness(sine, { inputs: { angle: loopOf([0, 90, 180]) } }).step().outputs.output).toEqual(loopOf([0, 1, 0]));
  });
});
