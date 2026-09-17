import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { loopSumPatch } from "./loopSum.ts";

describe("loopSum", () => {
  it("adds numbers, and an empty loop sums to 0", () => {
    const h = createPatchHarness(loopSumPatch);
    expect(h.step().outputs.sum).toBe(0);
    expect(h.step({ inputs: { loop: loopOf([1, 2, 3.5]) } }).outputs.sum).toBe(6.5);
    expect(h.step({ inputs: { loop: 4 } }).outputs.sum).toBe(4);
  });

  it("counts on/off values as 1 and 0", () => {
    const h = createPatchHarness(loopSumPatch, { inputs: { loop: loopOf([true, false, true]) } });
    expect(h.step().outputs.sum).toBe(2);
  });

  it("adds vectors component by component", () => {
    const h = createPatchHarness(loopSumPatch, { typeParam: "point", inputs: { loop: loopOf([[1, 2], [3, 4], 5]) } });
    expect(h.step().outputs.sum).toEqual([9, 11]);
    expect(h.step({ inputs: { loop: loopOf([]) } }).outputs.sum).toEqual([0, 0]);
    const h3 = createPatchHarness(loopSumPatch, { typeParam: "point3d" });
    expect(h3.step().outputs.sum).toEqual([0, 0, 0]);
  });

  it("joins text in order with no separator", () => {
    const h = createPatchHarness(loopSumPatch, { typeParam: "text", inputs: { loop: loopOf(["a", "b", "c"]) } });
    expect(h.step().outputs.sum).toBe("abc");
    expect(h.step({ inputs: { loop: loopOf([]) } }).outputs.sum).toBe("");
  });

  it("outputs 0 for a total that isn't finite and warns once", () => {
    const h = createPatchHarness(loopSumPatch, { inputs: { loop: loopOf([1e308, 1e308]) } });
    expect(h.run(2).outputs.sum).toBe(0);
    const p = createPatchHarness(loopSumPatch, { typeParam: "size", inputs: { loop: loopOf([[1e308, 1], [1e308, 2]]) } });
    expect(p.step().outputs.sum).toEqual([0, 3]);
    expect(h.logs.map((l) => l.message)).toEqual(["Loop Sum: the total got too large to show, so it outputs 0."]);
    expect(p.logs).toHaveLength(1);
  });
});
