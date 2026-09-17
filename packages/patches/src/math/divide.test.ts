import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { divide } from "./divide.ts";

describe("divide", () => {
  it("divides Value 1 by each later value", () => {
    expect(createPatchHarness(divide).step().outputs.output).toBe(1);
    expect(createPatchHarness(divide, { inputs: { value1: 10, value2: 4 } }).step().outputs.output).toBe(2.5);
    expect(createPatchHarness(divide, { inputCount: 3, inputs: { value1: 100, value2: 5, value3: 4 } }).step().outputs.output).toBe(5);
  });

  it("outputs 0 for a zero divisor and names the port once per restart", () => {
    const h = createPatchHarness(divide, { id: "divide_1", inputCount: 3, inputs: { value1: 10, value2: 0, value3: 2 } });
    expect(h.step().outputs.output).toBe(0);
    h.step({ inputs: { value2: -0 } });
    expect(h.output("output")).toBe(0);
    expect(h.logs.map((l) => l.message)).toEqual(["divide_1: Value 2 is 0, so the output is 0."]);
    h.restart();
    h.step();
    expect(h.logs).toHaveLength(2);
  });

  it("divides vector components independently", () => {
    const run = runPatch(divide, [{ value1: [10, 20], value2: [0, 4] }], { typeParam: "point" });
    expect(run.frames[0]!.outputs.output).toEqual([0, 5]);
    expect(run.logs).toHaveLength(1);
  });

  it("evaluates once per loop index", () => {
    expect(createPatchHarness(divide, { inputs: { value1: loopOf([2, 4]), value2: 2 } }).step().outputs.output).toEqual(loopOf([1, 2]));
  });
});
