import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { lessThan } from "./lessThan.ts";

describe("lessThan", () => {
  it("is strict, so two unconnected inputs output false", () => {
    const h = createPatchHarness(lessThan);
    expect(h.step().outputs.output).toBe(false);
    expect(h.step({ inputs: { value1: -1 } }).outputs.output).toBe(true);
  });

  it("compares each value with the next one", () => {
    const h = createPatchHarness(lessThan, { inputCount: 3, inputs: { value1: 1, value2: 2, value3: 3 } });
    expect(h.step().outputs.output).toBe(true);
    expect(h.step({ inputs: { value1: 3, value2: 10, value3: 4 } }).outputs.output).toBe(false);
  });

  it("treats booleans as 1 and 0", () => {
    expect(createPatchHarness(lessThan, { typeParam: "boolean", inputs: { value1: false, value2: true } }).step().outputs.output).toBe(true);
  });

  it("evaluates once per loop index", () => {
    expect(createPatchHarness(lessThan, { inputs: { value1: loopOf([4, 5, 6]), value2: 5 } }).step().outputs.output).toEqual(loopOf([true, false, false]));
  });

  it("outputs false while muted", () => {
    expect(runPatch(lessThan, [{ value1: 1, value2: 2 }], { muted: true }).frames[0]!.outputs.output).toBe(false);
  });
});
