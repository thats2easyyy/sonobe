import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { absoluteValue } from "./absoluteValue.ts";

describe("absoluteValue", () => {
  it("drops the sign and folds -0", () => {
    expect(createPatchHarness(absoluteValue, { inputs: { value: -5 } }).step().outputs.output).toBe(5);
    expect(Object.is(createPatchHarness(absoluteValue, { inputs: { value: -0 } }).step().outputs.output, 0)).toBe(true);
  });

  it("works per component and per loop index", () => {
    expect(createPatchHarness(absoluteValue, { typeParam: "point3d", inputs: { value: [-1, 2, -3] } }).step().outputs.output).toEqual([1, 2, 3]);
    expect(createPatchHarness(absoluteValue, { inputs: { value: loopOf([-1, 0, 1]) } }).step().outputs.output).toEqual(loopOf([1, 0, 1]));
  });
});
