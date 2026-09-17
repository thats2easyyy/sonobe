import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { length } from "./length.ts";

describe("length", () => {
  it("measures numbers and vectors", () => {
    expect(createPatchHarness(length, { inputs: { value: -5 } }).step().outputs.length).toBe(5);
    expect(createPatchHarness(length, { typeParam: "point", inputs: { value: [3, 4] } }).step().outputs.length).toBe(5);
    expect(createPatchHarness(length, { typeParam: "point3d", inputs: { value: [2, 3, 6] } }).step().outputs.length).toBe(7);
    expect(createPatchHarness(length, { typeParam: "point4d", inputs: { value: [1, 1, 1, 1] } }).step().outputs.length).toBe(2);
    expect(createPatchHarness(length, { typeParam: "point", inputs: { value: 5 } }).step().outputs.length).toBeCloseTo(7.0710678, 6);
  });

  it("outputs 0 for overflow and warns once", () => {
    const h = createPatchHarness(length, { typeParam: "point", inputs: { value: [1e200, 1e200] } });
    expect(h.run(2).outputs.length).toBe(0);
    expect(h.logs).toHaveLength(1);
  });

  it("evaluates once per loop index", () => {
    expect(createPatchHarness(length, { inputs: { value: loopOf([-1, 2]) } }).step().outputs.length).toEqual(loopOf([1, 2]));
  });

  it("passes a number through while muted and outputs 0 for vectors", () => {
    expect(runPatch(length, [{ value: -5 }], { muted: true }).frames[0]!.outputs.length).toBe(-5);
    expect(runPatch(length, [{ value: [3, 4] }], { typeParam: "point", muted: true }).frames[0]!.outputs.length).toBe(0);
  });
});
