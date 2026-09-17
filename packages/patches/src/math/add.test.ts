import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { add } from "./add.ts";

describe("add", () => {
  it("adds its inputs top to bottom", () => {
    const h = createPatchHarness(add);
    expect(h.step().outputs.output).toBe(0);
    expect(h.step({ inputs: { value1: 2, value2: 3 } }).outputs.output).toBe(5);
    expect(createPatchHarness(add, { inputCount: 3, inputs: { value1: 2, value2: 3, value3: 4 } }).step().outputs.output).toBe(9);
  });

  it("adds vectors component-wise and broadcasts numbers into them", () => {
    const h = createPatchHarness(add, { typeParam: "point", inputs: { value1: [1, 2], value2: [3, 4] } });
    expect(h.step().outputs.output).toEqual([4, 6]);
    expect(h.step({ inputs: { value2: 5 } }).outputs.output).toEqual([6, 7]);
    expect(createPatchHarness(add, { typeParam: "point4d", inputs: { value1: [1, 2, 3, 4], value2: [1, 1, 1, 1] } }).step().outputs.output).toEqual([2, 3, 4, 5]);
  });

  it("joins text in port order", () => {
    const h = createPatchHarness(add, { typeParam: "text", inputCount: 3, inputs: { value1: "Page ", value2: 3, value3: "" } });
    expect(h.step().outputs.output).toBe("Page 3");
    expect(runPatch(add, [{ value1: "Hello, ", value2: "world" }], { typeParam: "text" }).frames[0]!.outputs.output).toBe("Hello, world");
  });

  it("evaluates once per loop index", () => {
    expect(createPatchHarness(add, { inputs: { value1: loopOf([1, 2, 3]), value2: 10 } }).step().outputs.output).toEqual(loopOf([11, 12, 13]));
    expect(runPatch(add, [{ value1: loopOf([]), value2: 1 }]).frames[0]!.outputs.output).toEqual(loopOf([]));
  });

  it("outputs 0 for overflow, warns once per restart, and folds -0", () => {
    const h = createPatchHarness(add, { inputs: { value1: 1.7e308, value2: 1.7e308 } });
    expect(h.step().outputs.output).toBe(0);
    h.step();
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    h.restart();
    h.step();
    expect(h.logs).toHaveLength(2);
    expect(Object.is(createPatchHarness(add, { inputs: { value1: -0, value2: -0 } }).step().outputs.output, 0)).toBe(true);
  });
});
