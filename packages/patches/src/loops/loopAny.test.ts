import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { loopAnyPatch } from "./loopAny.ts";

describe("loopAny", () => {
  it("is on when any item is on, and off unconnected or for an empty loop", () => {
    const h = createPatchHarness(loopAnyPatch);
    expect(h.step().outputs.output).toBe(false);
    expect(h.step({ inputs: { loop: loopOf([false, true, false]) } }).outputs.output).toBe(true);
    expect(h.step({ inputs: { loop: loopOf([false, false]) } }).outputs.output).toBe(false);
    expect(h.step({ inputs: { loop: loopOf([]) } }).outputs.output).toBe(false);
    expect(h.step({ inputs: { loop: true } }).outputs.output).toBe(true);
  });

  it("follows a looped pulse frame by frame", () => {
    const h = createPatchHarness(loopAnyPatch);
    expect(h.step({ inputs: { loop: loopOf([false, true]) } }).outputs.output).toBe(true);
    expect(h.step({ inputs: { loop: loopOf([true, false]) } }).outputs.output).toBe(true);
    expect(h.step({ inputs: { loop: loopOf([false, false]) } }).outputs.output).toBe(false);
  });

  it("answers per group", () => {
    const h = createPatchHarness(loopAnyPatch, { inputs: { loop: loopOf([false, true, false, false]), grouping: loopOf([0, 0, 1, 1]) } });
    expect(h.step().outputs.output).toEqual(loopOf([true, false]));
  });

  it("wraps a shorter Grouping loop", () => {
    const h = createPatchHarness(loopAnyPatch, { inputs: { loop: loopOf([true, false, false, false]), grouping: loopOf([0, 1]) } });
    expect(h.step().outputs.output).toEqual(loopOf([true, false]));
  });

  it("answers off for groups without items, ignores negative ids, and rounds ids down", () => {
    const h = createPatchHarness(loopAnyPatch, { inputs: { loop: loopOf([true, true, false]), grouping: loopOf([2, -1, 0.9]) } });
    expect(h.step().outputs.output).toEqual(loopOf([false, false, true]));
  });

  it("gives one answer when every group id is negative or not finite", () => {
    const h = createPatchHarness(loopAnyPatch, { inputs: { loop: loopOf([true]), grouping: loopOf([-1, Number.NaN, Infinity]) } });
    expect(h.step().outputs.output).toBe(true);
  });

  it("gives an empty loop for an empty loop with grouping", () => {
    const h = createPatchHarness(loopAnyPatch, { inputs: { loop: loopOf([]), grouping: 0 } });
    expect(h.step().outputs.output).toEqual(loopOf([]));
  });

  it("ignores group ids of 10,000 or more with one warning", () => {
    const h = createPatchHarness(loopAnyPatch, { inputs: { loop: loopOf([true, true]), grouping: loopOf([10_000, 1]) } });
    expect(h.run(2).outputs.output).toEqual(loopOf([false, true]));
    expect(h.logs.map((l) => l.message)).toEqual(["Any: group numbers of 10,000 or more are ignored."]);
  });
});
