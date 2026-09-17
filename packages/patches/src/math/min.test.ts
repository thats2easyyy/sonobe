import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { min } from "./min.ts";

describe("min", () => {
  it("outputs the smallest input", () => {
    expect(createPatchHarness(min, { inputs: { value1: 3, value2: 1 } }).step().outputs.output).toBe(1);
    expect(createPatchHarness(min, { inputCount: 3, inputs: { value1: 5, value2: -2, value3: 7 } }).step().outputs.output).toBe(-2);
    expect(Object.is(createPatchHarness(min, { inputs: { value1: 0, value2: -0 } }).step().outputs.output, 0)).toBe(true);
  });

  it("compares components independently", () => {
    expect(createPatchHarness(min, { typeParam: "point", inputs: { value1: [10, 50], value2: [30, 20] } }).step().outputs.output).toEqual([10, 20]);
  });

  it("evaluates once per loop index", () => {
    expect(createPatchHarness(min, { inputs: { value1: loopOf([1, 5, 9]), value2: 4 } }).step().outputs.output).toEqual(loopOf([1, 4, 4]));
  });
});
