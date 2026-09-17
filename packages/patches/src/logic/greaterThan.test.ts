import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { greaterThan } from "./greaterThan.ts";

describe("greaterThan", () => {
  it("is strict, so two unconnected inputs output false", () => {
    const h = createPatchHarness(greaterThan);
    expect(h.step().outputs.output).toBe(false);
    expect(h.step({ inputs: { value1: 2, value2: 1 } }).outputs.output).toBe(true);
    expect(h.step({ inputs: { value2: 2 } }).outputs.output).toBe(false);
  });

  it("compares each value with the next one", () => {
    const h = createPatchHarness(greaterThan, { inputCount: 3, inputs: { value1: 3, value2: 2, value3: 1 } });
    expect(h.step().outputs.output).toBe(true);
    expect(h.step({ inputs: { value1: 4, value2: 3, value3: 10 } }).outputs.output).toBe(false);
    expect(h.step({ inputs: { value1: 10, value2: 3, value3: 4 } }).outputs.output).toBe(false);
  });

  it("treats booleans as 1 and 0 and compares indices", () => {
    expect(createPatchHarness(greaterThan, { typeParam: "boolean", inputs: { value1: true, value2: false } }).step().outputs.output).toBe(true);
    expect(createPatchHarness(greaterThan, { typeParam: "boolean", inputs: { value1: false, value2: true } }).step().outputs.output).toBe(false);
    expect(createPatchHarness(greaterThan, { typeParam: "index", inputs: { value1: 2, value2: 1 } }).step().outputs.output).toBe(true);
  });

  it("evaluates once per loop index", () => {
    const h = createPatchHarness(greaterThan, { inputs: { value1: loopOf([0, 5, 10]), value2: 5 } });
    expect(h.step().outputs.output).toEqual(loopOf([false, false, true]));
  });

  it("outputs false while muted and clamps hand-edited counts", () => {
    expect(runPatch(greaterThan, [{ value1: true, value2: false }], { typeParam: "boolean", muted: true }).frames[0]!.outputs.output).toBe(false);
    expect(runPatch(greaterThan, [{ value1: 2, value2: 1 }], { inputCount: 1 }).frames[0]!.outputs.output).toBe(true);
  });
});
