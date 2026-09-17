import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { foldPower, power } from "./power.ts";

const pow = (...values: number[]) => createPatchHarness(power, { inputCount: values.length, inputs: Object.fromEntries(values.map((v, i) => [`value${i + 1}`, v])) }).step().outputs.output;

describe("power", () => {
  it("raises the base to each exponent in turn", () => {
    expect(createPatchHarness(power).step().outputs.output).toBe(1);
    expect(pow(2, 3)).toBe(8);
    expect(pow(2, 3, 2)).toBe(64);
    expect(pow(0, 0)).toBe(1);
    expect(pow(-2, 3)).toBe(-8);
    expect(pow(9, 0.5)).toBe(3);
  });

  it("outputs 0 and warns once when there's no real or finite result", () => {
    const h = createPatchHarness(power, { inputs: { value1: -8, value2: 1 / 3 } });
    expect(h.step().outputs.output).toBe(0);
    expect(h.step({ inputs: { value1: 0, value2: -1 } }).outputs.output).toBe(0);
    expect(h.logs).toHaveLength(1);
    const parts = [2, -8];
    expect(foldPower(parts, [[2, 0.5]])).toBe(true);
    expect(parts).toEqual([4, 0]);
  });

  it("works per component and per loop index", () => {
    expect(createPatchHarness(power, { typeParam: "point", inputs: { value1: [2, 3], value2: 2 } }).step().outputs.output).toEqual([4, 9]);
    expect(createPatchHarness(power, { inputs: { value1: loopOf([1, 2, 3]), value2: 2 } }).step().outputs.output).toEqual(loopOf([1, 4, 9]));
  });
});
