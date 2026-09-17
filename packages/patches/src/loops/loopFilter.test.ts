import { describe, expect, it } from "vitest";
import { createPatchHarness, loopItems, loopOf } from "../infra/index.ts";
import { loopFilterPatch } from "./loopFilter.ts";

const abc = loopOf(["a", "b", "c"]);

describe("loopFilter", () => {
  it("passes every item through with the default Include of 1", () => {
    const h = createPatchHarness(loopFilterPatch, { typeParam: "text", inputs: { loop: abc } });
    expect(h.step().outputs).toEqual({ output: abc, index: loopOf([0, 1, 2]) });
  });

  it("keeps items whose Include is on", () => {
    const h = createPatchHarness(loopFilterPatch, { typeParam: "text", inputs: { loop: abc, include: loopOf([true, false, true]) } });
    expect(h.step().outputs).toEqual({ output: loopOf(["a", "c"]), index: loopOf([0, 1]) });
  });

  it("repeats items by count, pairing the inputs and wrapping the shorter one", () => {
    const h = createPatchHarness(loopFilterPatch, { typeParam: "text", inputs: { loop: loopOf(["star"]), include: 4 } });
    expect(h.step().outputs.output).toEqual(loopOf(["star", "star", "star", "star"]));
    expect(h.step({ inputs: { loop: abc, include: loopOf([0, 2]) } }).outputs.output).toEqual(loopOf(["b", "b"]));
  });

  it("rounds counts down and drops NaN, zero, and negative counts", () => {
    const h = createPatchHarness(loopFilterPatch, { typeParam: "text", inputs: { loop: abc, include: loopOf([2.9, -1, Number.NaN]) } });
    expect(h.step().outputs.output).toEqual(loopOf(["a", "a"]));
  });

  it("caps the result at 10,000 items with one warning", () => {
    const h = createPatchHarness(loopFilterPatch, { typeParam: "text", inputs: { loop: abc, include: Infinity } });
    const out = loopItems(h.run(2).outputs.output);
    expect(out).toHaveLength(10_000);
    expect(out.every((v) => v === "a")).toBe(true);
    expect(h.logs.map((l) => l.message)).toEqual(["Loop Filter: result capped at 10,000 items."]);
  });

  it("gives empty outputs for an empty Loop or an empty Include", () => {
    const h = createPatchHarness(loopFilterPatch);
    expect(h.step().outputs).toEqual({ output: loopOf([]), index: loopOf([]) });
    expect(h.step({ inputs: { loop: abc, include: loopOf([]) } }).outputs).toEqual({ output: loopOf([]), index: loopOf([]) });
  });
});
