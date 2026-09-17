import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { reverseProgress } from "./reverseProgress.ts";

const reverse = (progress: unknown) => {
  const h = createPatchHarness(reverseProgress, { inputs: { progress } });
  return { output: h.step().outputs.output, logs: h.logs };
};

describe("reverseProgress", () => {
  it("outputs 1 − Progress, unclamped", () => {
    expect(reverse(0).output).toBe(1);
    expect(reverse(1).output).toBe(0);
    expect(reverse(0.25).output).toBe(0.75);
    expect(reverse(1.5).output).toBe(-0.5);
  });

  it("defaults to 1", () => {
    expect(createPatchHarness(reverseProgress).step().outputs.output).toBe(1);
  });

  it("outputs 0 for a non-finite Progress and warns", () => {
    const result = reverse(Number.NaN);
    expect(result.output).toBe(0);
    expect(result.logs).toHaveLength(1);
  });

  it("keeps the input loop's length", () => {
    expect(reverse(loopOf([0, 0.5, 1])).output).toEqual(loopOf([1, 0.5, 0]));
  });
});
