import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { loopAllPatch } from "./loopAll.ts";

describe("loopAll", () => {
  it("is on only when every item is on; off unconnected, on for an empty loop", () => {
    const h = createPatchHarness(loopAllPatch);
    expect(h.step().outputs.output).toBe(false);
    expect(h.step({ inputs: { loop: loopOf([true, true]) } }).outputs.output).toBe(true);
    expect(h.step({ inputs: { loop: loopOf([true, false]) } }).outputs.output).toBe(false);
    expect(h.step({ inputs: { loop: loopOf([]) } }).outputs.output).toBe(true);
    expect(h.step({ inputs: { loop: true } }).outputs.output).toBe(true);
  });

  it("answers per group", () => {
    const h = createPatchHarness(loopAllPatch, { inputs: { loop: loopOf([true, false, true, true]), grouping: loopOf([0, 0, 1, 1]) } });
    expect(h.step().outputs.output).toEqual(loopOf([false, true]));
  });

  it("answers on for groups without items", () => {
    const h = createPatchHarness(loopAllPatch, { inputs: { loop: loopOf([false]), grouping: 2 } });
    expect(h.step().outputs.output).toEqual(loopOf([true, true, false]));
  });

  it("gives one answer when Grouping is −1", () => {
    const h = createPatchHarness(loopAllPatch, { inputs: { loop: loopOf([true, false]), grouping: -1 } });
    expect(h.step().outputs.output).toBe(false);
  });

  it("ignores group ids of 10,000 or more with one warning", () => {
    const h = createPatchHarness(loopAllPatch, { inputs: { loop: loopOf([false, true]), grouping: loopOf([20_000, 0]) } });
    expect(h.step().outputs.output).toEqual(loopOf([true]));
    expect(h.logs.map((l) => l.message)).toEqual(["All: group numbers of 10,000 or more are ignored."]);
  });
});
