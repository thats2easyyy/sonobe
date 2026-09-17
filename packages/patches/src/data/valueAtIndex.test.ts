import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { valueAtIndex } from "./valueAtIndex.ts";

describe("valueAtIndex", () => {
  it("reads an element as JSON by default", () => {
    const h = createPatchHarness(valueAtIndex, { inputs: { array: [{ name: "Ada" }, null, "three"] } });
    expect(h.step().outputs).toEqual({ value: { name: "Ada" }, found: true });
    expect(h.step({ inputs: { index: 2 } }).outputs).toEqual({ value: "three", found: true });
  });

  it("floors float noise in the index", () => {
    const h = createPatchHarness(valueAtIndex, { typeParam: "number", inputs: { array: [10, 20, 30, 40, 50] } });
    expect(h.step({ inputs: { index: 2.9999999999999996 } }).outputs.value).toBe(40);
    expect(h.step({ inputs: { index: 1.5 } }).outputs.value).toBe(20);
  });

  it("outputs the zero value and found false out of range or for non-arrays", () => {
    const h = createPatchHarness(valueAtIndex, { typeParam: "number", inputs: { array: [1, 2] } });
    expect(h.step({ inputs: { index: -1 } }).outputs).toEqual({ value: 0, found: false });
    expect(h.step({ inputs: { index: 2 } }).outputs).toEqual({ value: 0, found: false });
    expect(h.step({ inputs: { index: 0, array: { 0: 1 } } }).outputs).toEqual({ value: 0, found: false });
    expect(createPatchHarness(valueAtIndex).step().outputs).toEqual({ value: null, found: false });
    expect(h.logs).toEqual([]);
  });

  it("finds present null elements and reads them as the zero value for other types", () => {
    expect(createPatchHarness(valueAtIndex, { inputs: { array: [null] } }).step().outputs).toEqual({ value: null, found: true });
    expect(createPatchHarness(valueAtIndex, { typeParam: "text", inputs: { array: [null] } }).step().outputs).toEqual({ value: "", found: true });
  });

  it("coerces elements to the patch's type", () => {
    expect(createPatchHarness(valueAtIndex, { typeParam: "number", inputs: { array: ["12"] } }).step().outputs.value).toBe(12);
    expect(createPatchHarness(valueAtIndex, { typeParam: "color", inputs: { array: ["#FF0000"] } }).step().outputs.value).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(createPatchHarness(valueAtIndex, { typeParam: "point", inputs: { array: [[3, 4]] } }).step().outputs.value).toEqual([3, 4]);
  });

  it("reads one element per loop index", () => {
    const h = createPatchHarness(valueAtIndex, { typeParam: "number", inputs: { array: [10, 20, 30], index: loopOf([0, 2, 5]) } });
    const f = h.step();
    expect(f.outputs.value).toEqual(loopOf([10, 30, 0]));
    expect(f.outputs.found).toEqual(loopOf([true, true, false]));
  });
});
