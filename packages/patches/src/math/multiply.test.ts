import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { multiply } from "./multiply.ts";

describe("multiply", () => {
  it("multiplies top to bottom with identity defaults", () => {
    expect(createPatchHarness(multiply).step().outputs.output).toBe(1);
    expect(createPatchHarness(multiply, { inputCount: 3, inputs: { value1: 2, value2: 3, value3: 4 } }).step().outputs.output).toBe(24);
  });

  it("multiplies vectors component-wise, with no dot product", () => {
    expect(createPatchHarness(multiply, { typeParam: "point", inputs: { value1: [2, 3], value2: [4, 5] } }).step().outputs.output).toEqual([8, 15]);
    expect(createPatchHarness(multiply, { typeParam: "point3d", inputs: { value1: [1, 2, 3], value2: 2 } }).step().outputs.output).toEqual([2, 4, 6]);
  });

  it("evaluates once per loop index", () => {
    expect(createPatchHarness(multiply, { inputs: { value1: loopOf([1, 2, 3]), value2: 2 } }).step().outputs.output).toEqual(loopOf([2, 4, 6]));
  });

  it("outputs 0 for overflow and warns once", () => {
    const h = createPatchHarness(multiply, { inputs: { value1: 1e200, value2: 1e200 } });
    expect(h.run(3).outputs.output).toBe(0);
    expect(h.logs).toHaveLength(1);
  });
});
