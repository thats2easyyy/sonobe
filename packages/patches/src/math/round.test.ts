import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { round, roundComponent } from "./round.ts";

const outputsFor = (value: unknown, places: number, typeParam?: string) => {
  const outputs = createPatchHarness(round, { typeParam, inputs: { value, places } }).step().outputs;
  return [outputs.rounded, outputs.roundedDown, outputs.roundedUp];
};

describe("round", () => {
  it("matches the golden values", () => {
    expect(outputsFor(1.005, 2)).toEqual([1.01, 1, 1.01]);
    expect(outputsFor(-2.5, 0)).toEqual([-3, -3, -2]);
    expect(outputsFor(0.7, 1)).toEqual([0.7, 0.7, 0.7]);
    expect(outputsFor(1234.5, -2)).toEqual([1200, 1200, 1300]);
    expect(outputsFor(-1.005, 2)).toEqual([-1.01, -1.01, -1]);
    expect(outputsFor(2.5, 0)).toEqual([3, 2, 3]);
  });

  it("rounds places to an integer and clamps them to ±15", () => {
    expect(roundComponent(1.2345, 1.5).rounded).toBe(1.23);
    expect(roundComponent(1.2345, 1.4).rounded).toBe(1.2);
    expect(roundComponent(1.25, 99).rounded).toBe(1.25);
    expect(roundComponent(123456, -99).rounded).toBe(0);
  });

  it("folds -0 and passes huge whole values through", () => {
    expect(Object.is(roundComponent(-0.4, 0).rounded, 0)).toBe(true);
    expect(Object.is(roundComponent(-0.4, 0).up, 0)).toBe(true);
    expect(Object.is(roundComponent(-0.004, 2).down, -0.01)).toBe(true);
    expect(roundComponent(2 ** 60, 2)).toEqual({ rounded: 2 ** 60, down: 2 ** 60, up: 2 ** 60 });
  });

  it("rounds each vector component with one Places value", () => {
    expect(outputsFor([1.25, -1.25], 1, "point")).toEqual([[1.3, -1.3], [1.2, -1.3], [1.3, -1.2]]);
  });

  it("evaluates once per loop index", () => {
    const h = createPatchHarness(round, { inputs: { value: loopOf([0.4, 0.5, 1.6]) } });
    expect(h.step().outputs.rounded).toEqual(loopOf([0, 1, 2]));
  });

  it("passes Value through every output while muted", () => {
    expect(runPatch(round, [{ value: 1.234 }], { muted: true }).frames[0]!.outputs).toEqual({ rounded: 1.234, roundedDown: 1.234, roundedUp: 1.234 });
  });
});
