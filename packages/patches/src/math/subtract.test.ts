import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { subtract } from "./subtract.ts";

describe("subtract", () => {
  it("folds left from Value 1", () => {
    expect(createPatchHarness(subtract).step().outputs.output).toBe(0);
    expect(createPatchHarness(subtract, { inputCount: 3, inputs: { value1: 10, value2: 3, value3: 2 } }).step().outputs.output).toBe(5);
  });

  it("subtracts vectors component-wise", () => {
    expect(createPatchHarness(subtract, { typeParam: "size", inputs: { value1: [5, 5], value2: [1, 2] } }).step().outputs.output).toEqual([4, 3]);
  });

  it("evaluates once per loop index", () => {
    expect(createPatchHarness(subtract, { inputs: { value1: 10, value2: loopOf([1, 2]) } }).step().outputs.output).toEqual(loopOf([9, 8]));
  });

  it("outputs 0 for overflow and warns once", () => {
    const run = runPatch(subtract, [{ value1: -1.7e308, value2: 1.7e308 }, {}]);
    expect(run.frames[1]!.outputs.output).toBe(0);
    expect(run.logs).toHaveLength(1);
  });
});
