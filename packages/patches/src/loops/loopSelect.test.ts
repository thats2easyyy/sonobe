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

  describe("Out of Range", () => {
    const picks = loopOf([0, 3, -1, 4, -4, 2.7]);
    const run = (outOfRange: string, inputs: Record<string, unknown> = {}) =>
      createPatchHarness(loopSelectPatch, { typeParam: "text", inputs: { loop: names, index: picks, outOfRange, fallback: "?", ...inputs } }).step();

    it("Skip leaves out-of-range indices out (the default)", () => {
      expect(run("skip").outputs.output).toEqual(loopOf(["Tokyo", "Oaxaca"]));
      expect(createPatchHarness(loopSelectPatch, { typeParam: "text", inputs: { loop: names, index: picks } }).step().outputs.output).toEqual(loopOf(["Tokyo", "Oaxaca"]));
    });

    it("Clamp takes the nearest end", () => {
      expect(run("clamp").outputs).toEqual({ output: loopOf(["Tokyo", "Oaxaca", "Tokyo", "Oaxaca", "Tokyo", "Oaxaca"]), outputIndex: loopOf([0, 1, 2, 3, 4, 5]) });
    });

    it("Wrap counts around, negatives from the end", () => {
      expect(run("wrap").outputs.output).toEqual(loopOf(["Tokyo", "Tokyo", "Oaxaca", "Lisbon", "Oaxaca", "Oaxaca"]));
    });

    it("Use Fallback gives Fallback", () => {
      expect(run("fallback").outputs.output).toEqual(loopOf(["Tokyo", "?", "?", "?", "?", "Oaxaca"]));
    });

    it("gives Fallback for non-numbers and an empty Loop in every mode but Skip", () => {
      const odd = loopOf([Number.NaN, Infinity, 1]);
      for (const mode of ["clamp", "wrap", "fallback"]) {
        expect(run(mode, { index: odd }).outputs.output, mode).toEqual(loopOf(["?", "?", "Lisbon"]));
        expect(run(mode, { loop: loopOf([]), index: loopOf([0, -1]) }).outputs.output, mode).toEqual(loopOf(["?", "?"]));
      }
      expect(run("skip", { index: odd }).outputs.output).toEqual(loopOf(["Lisbon"]));
      expect(run("skip", { loop: loopOf([]) }).outputs.output).toEqual(loopOf([]));
    });

    it("treats −1 as out of range in each mode", () => {
      const at = (mode: string) => run(mode, { index: -1 }).outputs.output;
      expect([at("skip"), at("clamp"), at("wrap"), at("fallback")]).toEqual([loopOf([]), loopOf(["Tokyo"]), loopOf(["Oaxaca"]), loopOf(["?"])]);
    });

    it("keeps a feedback deck running in the runtime: one value where a loop was expected still gives one item per index", () => {
      const result = runPatch(loopSelectPatch, [{ loop: false, index: { loop: [1, 2, 3, 3] }, outOfRange: "fallback", fallback: false }, { loop: { loop: [false, true, false, false] } }], { typeParam: "boolean" });
      expect(result.frames.map((f) => f.outputs.output)).toEqual([loopOf([false, false, false, false]), loopOf([true, false, false, false])]);
    });
  });

  describe("explaining an empty Output", () => {
    it("explains indices past the end of a non-empty Loop in Skip mode, offering Clamp and Use Fallback", () => {
      const h = createPatchHarness(loopSelectPatch, { typeParam: "boolean", inputs: { loop: false, index: loopOf([1, 2, 3, 3]) } });
      const frame = h.step();
      expect(frame.outputs.output).toEqual(loopOf([]));
      expect(frame.emptyExplanation?.reason).toBe("indices 1, 2 and 3 are past the end of its 1-item Loop");
      expect(frame.emptyExplanation?.fixes.map((f) => [f.input, f.value])).toEqual([
        ["outOfRange", "clamp"],
        ["outOfRange", "fallback"],
      ]);
      expect(h.step({ inputs: { index: 5 } }).emptyExplanation?.reason).toBe("index 5 is past the end of its 1-item Loop");
      expect(h.step({ inputs: { index: loopOf([4, 5, 6, 7, 8]) } }).emptyExplanation?.reason).toBe("indices 4, 5, 6 and 2 more are past the end of its 1-item Loop");
    });

    it("stays quiet for −1 (nothing selected), an empty Loop, a partial pick, and the other modes", () => {
      const quiet = (inputs: Record<string, unknown>) => createPatchHarness(loopSelectPatch, { typeParam: "text", inputs: { loop: names, ...inputs } }).step().emptyExplanation;
      expect(quiet({ index: -1 })).toBeUndefined();
      expect(quiet({ loop: loopOf([]), index: 3 })).toBeUndefined();
      expect(quiet({ index: loopOf([0, 5]) })).toBeUndefined();
      expect(quiet({ index: 5, outOfRange: "clamp" })).toBeUndefined();
    });
  });
});
