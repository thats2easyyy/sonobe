import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { and } from "./and.ts";

describe("and", () => {
  it("is on only while every input is on", () => {
    const h = createPatchHarness(and);
    expect(h.step().outputs.output).toBe(false);
    expect(h.step({ inputs: { value1: true } }).outputs.output).toBe(false);
    expect(h.step({ inputs: { value2: true } }).outputs.output).toBe(true);
    expect(h.step({ inputs: { value1: false } }).outputs.output).toBe(false);
  });

  it("coerces numbers and text to on/off", () => {
    const h = createPatchHarness(and, { inputs: { value1: 0.5, value2: "yes" } });
    expect(h.step().outputs.output).toBe(true);
    expect(h.step({ inputs: { value1: 0 } }).outputs.output).toBe(false);
    expect(h.step({ inputs: { value1: -2 } }).outputs.output).toBe(false);
  });

  it("checks every added input", () => {
    const h = createPatchHarness(and, { inputCount: 3, inputs: { value1: true, value2: true } });
    expect(h.step().outputs.output).toBe(false);
    expect(h.step({ inputs: { value3: true } }).outputs.output).toBe(true);
  });

  it("evaluates once per loop index", () => {
    const h = createPatchHarness(and, { inputs: { value1: loopOf([true, false, true]), value2: loopOf([true, true]) } });
    expect(h.step().outputs.output).toEqual(loopOf([true, false, true]));
    expect(runPatch(and, [{ value1: loopOf([]), value2: true }]).frames[0]!.outputs.output).toEqual(loopOf([]));
  });

  it("clamps hand-edited counts and passes Value 1 through while muted", () => {
    expect(runPatch(and, [{ value1: true, value2: true }], { inputCount: 99 }).frames[0]!.outputs.output).toBe(false);
    expect(runPatch(and, [{ value1: true, value2: false }], { muted: true }).frames[0]!.outputs.output).toBe(true);
  });
});
