import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { clamp, clampBetween } from "./clamp.ts";

describe("clamp", () => {
  it("keeps Value between Min and Max", () => {
    const h = createPatchHarness(clamp);
    expect(h.step().outputs.output).toBe(0);
    expect(h.step({ inputs: { value: 1.5 } }).outputs.output).toBe(1);
    expect(h.step({ inputs: { value: -1 } }).outputs.output).toBe(0);
    expect(h.step({ inputs: { value: 0.25 } }).outputs.output).toBe(0.25);
  });

  it("swaps reversed limits and holds equal limits", () => {
    expect([clampBetween(5, 10, 0), clampBetween(15, 10, 0), clampBetween(-5, 10, 0)]).toEqual([5, 10, 0]);
    expect(clampBetween(99, 3, 3)).toBe(3);
  });

  it("clamps vector components with per-variant defaults and per-component swaps", () => {
    expect(createPatchHarness(clamp, { typeParam: "point", inputs: { value: [2, -1] } }).step().outputs.output).toEqual([1, 0]);
    expect(runPatch(clamp, [{ value: [2, -1] }], { typeParam: "size" }).frames[0]!.outputs.output).toEqual([1, 0]);
    expect(createPatchHarness(clamp, { typeParam: "point", inputs: { value: [5, 50], min: [10, 0], max: [0, 10] } }).step().outputs.output).toEqual([5, 10]);
  });

  it("evaluates once per loop index", () => {
    expect(createPatchHarness(clamp, { inputs: { value: loopOf([-1, 0.5, 2]) } }).step().outputs.output).toEqual(loopOf([0, 0.5, 1]));
  });
});
