import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { greaterThanOrEqual } from "./greaterThanOrEqual.ts";

describe("greaterThanOrEqual", () => {
  it("is inclusive, so two unconnected inputs output true", () => {
    const h = createPatchHarness(greaterThanOrEqual);
    expect(h.step().outputs.output).toBe(true);
    expect(h.step({ inputs: { value1: 1, value2: 2 } }).outputs.output).toBe(false);
  });

  it("compares each value with the next one", () => {
    const h = createPatchHarness(greaterThanOrEqual, { inputCount: 3, inputs: { value1: 3, value2: 2, value3: 2 } });
    expect(h.step().outputs.output).toBe(true);
    expect(h.step({ inputs: { value1: 4, value2: 4, value3: 10 } }).outputs.output).toBe(false);
    expect(h.step({ inputs: { value1: 10, value2: 3, value3: 4 } }).outputs.output).toBe(false);
  });

  it("evaluates once per loop index", () => {
    expect(createPatchHarness(greaterThanOrEqual, { inputs: { value1: loopOf([4, 5, 6]), value2: 5 } }).step().outputs.output).toEqual(loopOf([false, true, true]));
  });

  it("outputs false while muted", () => {
    expect(runPatch(greaterThanOrEqual, [{}], { muted: true }).frames[0]!.outputs.output).toBe(false);
  });
});
