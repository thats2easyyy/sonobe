import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { sampleAndHoldPatch } from "./sampleAndHold.ts";

describe("sampleAndHold", () => {
  it("outputs the zero value until something is sampled", () => {
    expect(createPatchHarness(sampleAndHoldPatch, { inputs: { value: 5 } }).step().outputs.output).toBe(0);
    expect(createPatchHarness(sampleAndHoldPatch, { typeParam: "color" }).step().outputs.output).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(createPatchHarness(sampleAndHoldPatch, { typeParam: "text" }).step().outputs.output).toBe("");
    expect(createPatchHarness(sampleAndHoldPatch, { typeParam: "point3d" }).step().outputs.output).toEqual([0, 0, 0]);
    expect(createPatchHarness(sampleAndHoldPatch, { typeParam: "layer" }).step().outputs.output).toBeNull();
    expect(createPatchHarness(sampleAndHoldPatch, { typeParam: "json" }).step().outputs.output).toBeNull();
  });

  it("captures on the same frame Sample is on, and holds while it's off", () => {
    const h = createPatchHarness(sampleAndHoldPatch, { inputs: { value: 5 } });
    h.step();
    expect(h.step({ inputs: { sample: true } }).outputs.output).toBe(5);
    expect(h.step({ inputs: { sample: false, value: 9 } }).outputs.output).toBe(5);
    expect(h.step({ inputs: { value: 12 } }).outputs.output).toBe(5);
  });

  it("tracks Value continuously while Sample stays on", () => {
    const h = createPatchHarness(sampleAndHoldPatch, { inputs: { sample: 1 } });
    expect([1, 2, 3].map((value) => h.step({ inputs: { value } }).outputs.output)).toEqual([1, 2, 3]);
  });

  it("captures frame 0's value when Sample starts on", () => {
    expect(createPatchHarness(sampleAndHoldPatch, { inputs: { value: 4, sample: true } }).step().outputs.output).toBe(4);
  });

  it("clears on Reset, and a same-frame Sample wins", () => {
    const h = createPatchHarness(sampleAndHoldPatch, { typeParam: "point", inputs: { value: [3, 4], sample: true } });
    h.step();
    h.set({ sample: false });
    expect(h.step({ pulses: ["reset"] }).outputs.output).toEqual([0, 0]);
    expect(h.step({ inputs: { sample: true, value: [7, 8] }, pulses: ["reset"] }).outputs.output).toEqual([7, 8]);
  });

  it("stores one value per loop index", () => {
    const h = createPatchHarness(sampleAndHoldPatch, { inputs: { value: loopOf([10, 20, 30]), sample: true } });
    expect(h.step().outputs.output).toEqual(loopOf([10, 20, 30]));
    expect(h.step({ inputs: { value: loopOf([1, 2, 3]), sample: loopOf([false, true, false]) } }).outputs.output).toEqual(loopOf([10, 2, 30]));
    expect(h.step({ inputs: { value: loopOf([1, 2, 3, 4]), sample: false } }).outputs.output).toEqual(loopOf([10, 2, 30, 0]));
  });

  it("clears every index on restart", () => {
    const h = createPatchHarness(sampleAndHoldPatch, { inputs: { value: 5, sample: true } });
    h.step();
    h.restart();
    h.set({ sample: false });
    expect(h.step().outputs.output).toBe(0);
  });
});
