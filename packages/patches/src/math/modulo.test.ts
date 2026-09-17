import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { modulo } from "./modulo.ts";

const mod = (a: number, b: number) => createPatchHarness(modulo, { inputs: { value1: a, value2: b } }).step().outputs.output;

describe("modulo", () => {
  it("uses floored modulo, so the result has the divisor's sign", () => {
    expect([mod(7, 3), mod(-1, 3), mod(7, -3), mod(5.5, 2)]).toEqual([1, 2, -2, 1.5]);
    expect(createPatchHarness(modulo).step().outputs.output).toBe(0);
  });

  it("guards against round-off at the divisor", () => {
    expect(mod(-1e-17, 3)).toBe(0);
    expect(Object.is(mod(-3, 3), 0)).toBe(true);
  });

  it("outputs 0 for a zero divisor, keeps it at 0, and warns once", () => {
    const h = createPatchHarness(modulo, { inputCount: 3, inputs: { value1: 7, value2: 0, value3: 3 } });
    expect(h.run(2).outputs.output).toBe(0);
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]!.message).toContain("Value 2 is 0");
  });

  it("wraps vector components and loops", () => {
    expect(createPatchHarness(modulo, { typeParam: "point", inputs: { value1: [370, -10], value2: 360 } }).step().outputs.output).toEqual([10, 350]);
    expect(createPatchHarness(modulo, { inputs: { value1: loopOf([0, 1, 2, 3, 4]), value2: 3 } }).step().outputs.output).toEqual(loopOf([0, 1, 2, 0, 1]));
  });
});
