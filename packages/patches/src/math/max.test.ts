import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { max } from "./max.ts";

describe("max", () => {
  it("outputs the largest input", () => {
    expect(createPatchHarness(max, { inputs: { value1: 3, value2: 1 } }).step().outputs.output).toBe(3);
    expect(createPatchHarness(max, { inputCount: 4, inputs: { value1: -5, value2: -2, value3: -7, value4: -3 } }).step().outputs.output).toBe(-2);
  });

  it("compares components independently", () => {
    expect(createPatchHarness(max, { typeParam: "point", inputs: { value1: [10, 50], value2: [30, 20] } }).step().outputs.output).toEqual([30, 50]);
  });

  it("evaluates once per loop index", () => {
    expect(createPatchHarness(max, { inputs: { value1: loopOf([1, 5, 9]), value2: 4 } }).step().outputs.output).toEqual(loopOf([4, 5, 9]));
  });
});
