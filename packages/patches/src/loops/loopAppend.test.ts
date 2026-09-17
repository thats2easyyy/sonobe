import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopItems, loopOf } from "../infra/index.ts";
import { loopAppendPatch } from "./loopAppend.ts";

describe("loopAppend", () => {
  it("adds Value to the end on each pulse, starting empty", () => {
    const h = createPatchHarness(loopAppendPatch, { inputs: { value: 1 } });
    expect(h.step().outputs).toEqual({ output: loopOf([]), index: loopOf([]) });
    expect(h.step({ pulses: ["append"] }).outputs).toEqual({ output: loopOf([1]), index: loopOf([0]) });
    expect(h.step({ inputs: { value: 2 }, pulses: ["append"] }).outputs).toEqual({ output: loopOf([1, 2]), index: loopOf([0, 1]) });
    expect(h.run(3).outputs.output).toEqual(loopOf([1, 2]));
  });

  it("copies Value on the pulse frame", () => {
    const value = { sku: "a" };
    const h = createPatchHarness(loopAppendPatch, { typeParam: "json", inputs: { value } });
    h.step({ pulses: ["append"] });
    value.sku = "b";
    expect(h.step().outputs.output).toEqual(loopOf([{ sku: "a" }]));
  });

  it("keeps appended values at the end when Loop changes", () => {
    const h = createPatchHarness(loopAppendPatch, { typeParam: "text", inputs: { loop: loopOf(["a"]), value: "x" } });
    h.step({ pulses: ["append"] });
    expect(h.step({ inputs: { loop: loopOf(["p", "q"]) } }).outputs.output).toEqual(loopOf(["p", "q", "x"]));
    expect(h.step({ inputs: { loop: loopOf([]) } }).outputs.output).toEqual(loopOf(["x"]));
  });

  it("resets first, so Reset and Append in one frame gives Loop plus the new item", () => {
    const h = createPatchHarness(loopAppendPatch, { inputs: { loop: loopOf([0]), value: 1 } });
    h.step({ pulses: ["append"] });
    h.step({ pulses: ["append"] });
    expect(h.step({ inputs: { value: 5 }, pulses: ["reset", "append"] }).outputs.output).toEqual(loopOf([0, 5]));
    expect(h.step({ pulses: ["reset"] }).outputs.output).toEqual(loopOf([0]));
  });

  it("applies a pulse on frame 0", () => {
    const h = createPatchHarness(loopAppendPatch, { inputs: { value: 3 } });
    expect(h.step({ pulses: ["append"] }).outputs.output).toEqual(loopOf([3]));
  });

  it("skips appends at 10,000 items with one warning", () => {
    const h = createPatchHarness(loopAppendPatch, { inputs: { loop: loopOf(Array.from({ length: 9_999 }, () => 0)) } });
    expect(loopItems(h.step({ pulses: ["append"] }).outputs.output)).toHaveLength(10_000);
    h.step({ pulses: ["append"] });
    h.step({ pulses: ["append"] });
    expect(loopItems(h.step().outputs.output)).toHaveLength(10_000);
    expect(h.logs.map((l) => l.message)).toEqual(["Loop Append reached 10,000 items, so this append was skipped."]);
  });

  it("reads item 0 of looped single-value inputs and warns once", () => {
    const h = createPatchHarness(loopAppendPatch, { inputs: { value: loopOf([4, 5]) } });
    expect(h.step({ pulses: ["append"] }).outputs.output).toEqual(loopOf([4]));
    h.step({ pulses: ["append"] });
    expect(h.logs).toHaveLength(1);
  });

  it("forgets appended values when the patch's type changes and on restart", () => {
    const h = createPatchHarness(loopAppendPatch, { inputs: { value: 1 } });
    h.step({ pulses: ["append"] });
    h.state()!.variant = "color";
    expect(h.step().outputs.output).toEqual(loopOf([]));
    h.step({ pulses: ["append"] });
    h.restart();
    expect(h.step().outputs.output).toEqual(loopOf([]));
  });

  it("outputs Loop unchanged and ignores pulses while muted", () => {
    expect(loopAppendPatch.mutedBehavior).toBe("evaluate");
    const result = runPatch(loopAppendPatch, [{ loop: loopOf([1, 2, 3]), value: 9, append: true }], { muted: true });
    expect(result.frames[0]!.outputs).toEqual({ output: loopOf([1, 2, 3]), index: loopOf([0, 1, 2]) });
  });

  it("appends in the runtime on consecutive pulses", () => {
    const result = runPatch(loopAppendPatch, [{ value: "a", append: true }, { value: "b", append: true }, {}], { typeParam: "text" });
    expect(result.frames.map((f) => f.outputs.output)).toEqual([loopOf(["a"]), loopOf(["a", "b"]), loopOf(["a", "b"])]);
    expect(result.issues).toEqual([]);
  });
});
