import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { splitter } from "./splitter.ts";

describe("splitter", () => {
  it("passes Value through on the same frame, defaulting to the number 0", () => {
    const h = createPatchHarness(splitter);
    expect(h.step().outputs.output).toBe(0);
    expect(h.step({ inputs: { value: 358 } }).outputs.output).toBe(358);
  });

  it("starts other variants at their variant defaults or zero values", () => {
    expect(createPatchHarness(splitter, { typeParam: "color" }).step().outputs.output).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(createPatchHarness(splitter, { typeParam: "size" }).step().outputs.output).toEqual([100, 100]);
    expect(createPatchHarness(splitter, { typeParam: "text" }).step().outputs.output).toBe("");
    expect(createPatchHarness(splitter, { typeParam: "layer" }).step().outputs.output).toBeNull();
  });

  it("casts through core coercion before evaluating", () => {
    expect(createPatchHarness(splitter, { typeParam: "point", inputs: { value: 5 } }).step().outputs.output).toEqual([5, 5]);
    expect(createPatchHarness(splitter, { inputs: { value: "12" } }).step().outputs.output).toBe(12);
    expect(createPatchHarness(splitter, { typeParam: "point3d", inputs: { value: [10, 20] } }).step().outputs.output).toEqual([10, 20, 0]);
    expect(createPatchHarness(splitter, { typeParam: "size", inputs: { value: { width: 3, height: 4 } } }).step().outputs.output).toEqual([3, 4]);
    expect(createPatchHarness(splitter, { typeParam: "text", inputs: { value: true } }).step().outputs.output).toBe("true");
  });

  it("passes references without copying", () => {
    const ref = { layerId: "card", instance: 2 };
    expect(createPatchHarness(splitter, { typeParam: "layer", inputs: { value: ref } }).step().outputs.output).toBe(ref);
  });

  it("turns a pulse into a one-frame true when set to boolean", () => {
    const result = runPatch(splitter, [{ value: false }, { value: true }, { value: false }], { typeParam: "boolean" });
    expect(result.frames.map((f) => f.outputs.output)).toEqual([false, true, false]);
  });

  it("evaluates per loop index, and an empty loop gives an empty output", () => {
    const h = createPatchHarness(splitter, { inputs: { value: loopOf([1, 2, 3]) } });
    expect(h.step().outputs.output).toEqual(loopOf([1, 2, 3]));
    expect(runPatch(splitter, [{ value: loopOf([]) }]).frames[0]!.outputs.output).toEqual(loopOf([]));
  });

  it("still passes Value through while muted", () => {
    expect(runPatch(splitter, [{ value: 42 }], { muted: true }).frames[0]!.outputs.output).toBe(42);
  });
});
