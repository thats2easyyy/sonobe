import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { runningTotalPatch } from "./runningTotal.ts";

describe("runningTotal", () => {
  it("gives each item the total of the items before it", () => {
    const h = createPatchHarness(runningTotalPatch, { inputs: { loop: loopOf([1, 3, 5]) } });
    expect(h.step().outputs.total).toEqual(loopOf([0, 1, 4]));
  });

  it("includes each item itself with Include Current", () => {
    const h = createPatchHarness(runningTotalPatch, { inputs: { loop: loopOf([1, 3, 5]), includeCurrent: true } });
    expect(h.step().outputs.total).toEqual(loopOf([1, 4, 9]));
    expect(h.step({ inputs: { loop: loopOf([-24, 12, 16, 20]) } }).outputs.total).toEqual(loopOf([-24, -12, 4, 24]));
  });

  it("handles empty loops and plain numbers", () => {
    const h = createPatchHarness(runningTotalPatch);
    expect(h.step().outputs.total).toEqual(loopOf([]));
    expect(h.step({ inputs: { loop: 7 } }).outputs.total).toEqual(loopOf([0]));
    expect(h.step({ inputs: { includeCurrent: true } }).outputs.total).toEqual(loopOf([7]));
  });

  it("counts on/off values as 1 and 0", () => {
    const h = createPatchHarness(runningTotalPatch, { inputs: { loop: loopOf([true, false, true]) } });
    expect(h.step().outputs.total).toEqual(loopOf([0, 1, 1]));
  });

  it("counts non-finite items as 0 and zeroes overflowing totals, warning once each", () => {
    const h = createPatchHarness(runningTotalPatch, { inputs: { loop: loopOf([Number.NaN, 2]) } });
    expect(h.step().outputs.total).toEqual(loopOf([0, 0]));
    expect(h.step({ inputs: { loop: loopOf([1e308, 1e308, 1]) } }).outputs.total).toEqual(loopOf([0, 1e308, 0]));
    h.step({ inputs: { loop: loopOf([Infinity, 1e308, 1e308]) } });
    expect(h.logs.map((l) => l.message)).toEqual([
      "Running Total: an item isn't a finite number, so it counts as 0.",
      "Running Total: a total got too large to show, so it outputs 0.",
    ]);
  });

  it("reads item 0 of a looped Include Current", () => {
    const h = createPatchHarness(runningTotalPatch, { inputs: { loop: loopOf([2, 2]), includeCurrent: loopOf([true, false]) } });
    expect(h.step().outputs.total).toEqual(loopOf([2, 4]));
  });
});
