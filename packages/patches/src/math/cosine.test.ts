import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { cosine, cosineDegrees } from "./cosine.ts";

describe("cosine", () => {
  it("is exact at common angles in degrees", () => {
    expect([0, 60, 90, 180, 270, 360].map(cosineDegrees)).toEqual([1, 0.5, 0, -1, 0, 1]);
    expect(cosineDegrees(-60)).toBe(0.5);
  });

  it("outputs 0 for a non-finite angle and warns once", () => {
    const h = createPatchHarness(cosine, { inputs: { angle: Number.NaN } });
    expect(h.run(3).outputs.output).toBe(0);
    expect(h.logs).toHaveLength(1);
  });

  it("evaluates once per loop index", () => {
    expect(createPatchHarness(cosine, { inputs: { angle: loopOf([0, 90, 180]) } }).step().outputs.output).toEqual(loopOf([1, 0, -1]));
  });
});
