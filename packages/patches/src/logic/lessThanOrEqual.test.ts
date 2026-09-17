import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { lessThanOrEqual } from "./lessThanOrEqual.ts";

describe("lessThanOrEqual", () => {
  it("is inclusive, so two unconnected inputs output true", () => {
    expect(createPatchHarness(lessThanOrEqual).step().outputs.output).toBe(true);
  });

  it("compares each value with the next one", () => {
    const h = createPatchHarness(lessThanOrEqual, { inputCount: 3, inputs: { value1: 1, value2: 1, value3: 3 } });
    expect(h.step().outputs.output).toBe(true);
    expect(h.step({ inputs: { value1: 3, value2: 3, value3: 1 } }).outputs.output).toBe(false);
    expect(h.step({ inputs: { value1: 3, value2: 10, value3: 4 } }).outputs.output).toBe(false);
  });

  it("works as a between check: min ≤ value ≤ max", () => {
    const h = createPatchHarness(lessThanOrEqual, { inputCount: 3, inputs: { value1: 0, value2: loopOf([-1, 0, 0.5, 1, 2]), value3: 1 } });
    expect(h.step().outputs.output).toEqual(loopOf([false, true, true, true, false]));
  });

  it("outputs false while muted", () => {
    expect(runPatch(lessThanOrEqual, [{}], { muted: true }).frames[0]!.outputs.output).toBe(false);
  });
});
