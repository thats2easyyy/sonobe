import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { not } from "./not.ts";

describe("not", () => {
  it("outputs the opposite of its input", () => {
    const h = createPatchHarness(not);
    expect(h.step().outputs.output).toBe(true);
    expect(h.step({ inputs: { value: true } }).outputs.output).toBe(false);
    expect(h.step({ inputs: { value: "off" } }).outputs.output).toBe(true);
    expect(h.step({ inputs: { value: 0.1 } }).outputs.output).toBe(false);
  });

  it("evaluates once per loop index", () => {
    expect(createPatchHarness(not, { inputs: { value: loopOf([true, false]) } }).step().outputs.output).toEqual(loopOf([false, true]));
    expect(runPatch(not, [{ value: loopOf([]) }]).frames[0]!.outputs.output).toEqual(loopOf([]));
  });

  it("passes Value through while muted", () => {
    expect(runPatch(not, [{ value: true }], { muted: true }).frames[0]!.outputs.output).toBe(true);
  });
});
