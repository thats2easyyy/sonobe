import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { loopSelectPatch } from "./loopSelect.ts";

const names = loopOf(["Tokyo", "Lisbon", "Oaxaca"]);

describe("loopSelect", () => {
  it("picks one item by position", () => {
    const h = createPatchHarness(loopSelectPatch, { typeParam: "text", inputs: { loop: names, index: 1 } });
    expect(h.step().outputs).toEqual({ output: loopOf(["Lisbon"]), outputIndex: loopOf([0]) });
  });

  it("reorders and repeats items with a loop of indices", () => {
    const h = createPatchHarness(loopSelectPatch, { typeParam: "text", inputs: { loop: names, index: loopOf([2, 1, 0, 0]) } });
    expect(h.step().outputs).toEqual({ output: loopOf(["Oaxaca", "Lisbon", "Tokyo", "Tokyo"]), outputIndex: loopOf([0, 1, 2, 3]) });
  });

  it("skips out-of-range, negative, and non-finite indices and rounds down", () => {
    const h = createPatchHarness(loopSelectPatch, { typeParam: "text", inputs: { loop: names, index: loopOf([3, -1, -0.5, 2.7, Number.NaN, Infinity, -Infinity]) } });
    expect(h.step().outputs).toEqual({ output: loopOf(["Oaxaca"]), outputIndex: loopOf([0]) });
  });

  it("gives empty outputs for an empty loop or no valid index", () => {
    const h = createPatchHarness(loopSelectPatch);
    expect(h.step().outputs).toEqual({ output: loopOf([]), outputIndex: loopOf([]) });
    expect(h.step({ inputs: { loop: names, index: 9 } }).outputs).toEqual({ output: loopOf([]), outputIndex: loopOf([]) });
  });

  it("coerces items to the patch's type", () => {
    const h = createPatchHarness(loopSelectPatch, { typeParam: "color", inputs: { loop: loopOf(["#FF0000FF", "#00FF00FF"]), index: 1 } });
    expect(h.step().outputs.output).toEqual(loopOf([{ r: 0, g: 1, b: 0, a: 1 }]));
  });

  it("selects in the runtime", () => {
    const result = runPatch(loopSelectPatch, [{ loop: { loop: ["a", "b", "c"] }, index: 2 }, { index: { loop: [1, 1] } }], { typeParam: "text" });
    expect(result.frames.map((f) => f.outputs.output)).toEqual([loopOf(["c"]), loopOf(["b", "b"])]);
  });
});
