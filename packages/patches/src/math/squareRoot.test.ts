import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { squareRoot } from "./squareRoot.ts";

describe("squareRoot", () => {
  it("takes the square root", () => {
    expect(createPatchHarness(squareRoot).step().outputs.output).toBe(0);
    expect(createPatchHarness(squareRoot, { inputs: { value: 9 } }).step().outputs.output).toBe(3);
  });

  it("outputs 0 for negative input and warns once, but not for -0", () => {
    const h = createPatchHarness(squareRoot, { inputs: { value: -4 } });
    expect(h.run(2).outputs.output).toBe(0);
    expect(h.logs.map((l) => l.message)).toEqual(["patch_1: Value is below 0, so Square Root outputs 0 for it."]);
    const zero = createPatchHarness(squareRoot, { inputs: { value: -0 } });
    expect(Object.is(zero.step().outputs.output, 0)).toBe(true);
    expect(zero.logs).toEqual([]);
  });

  it("works per component and per loop index", () => {
    const run = runPatch(squareRoot, [{ value: [4, -1] }], { typeParam: "point" });
    expect(run.frames[0]!.outputs.output).toEqual([2, 0]);
    expect(run.logs).toHaveLength(1);
    expect(createPatchHarness(squareRoot, { inputs: { value: loopOf([1, 4, 16]) } }).step().outputs.output).toEqual(loopOf([1, 2, 4]));
  });
});
