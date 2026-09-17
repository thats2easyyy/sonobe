import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { arrayCount } from "./arrayCount.ts";

describe("arrayCount", () => {
  it("counts top-level elements, including nulls and nested values", () => {
    expect(createPatchHarness(arrayCount).step().outputs.count).toBe(0);
    expect(createPatchHarness(arrayCount, { inputs: { array: [null, [1, 2], { a: 1 }] } }).step().outputs.count).toBe(3);
  });

  it("counts anything that isn't an array as 0 without warning", () => {
    for (const array of [{ length: 3 }, "three", 3, null]) {
      const h = createPatchHarness(arrayCount, { inputs: { array } });
      expect(h.step().outputs.count).toBe(0);
      expect(h.logs).toEqual([]);
    }
  });

  it("gives a loop of counts for a loop of arrays", () => {
    expect(createPatchHarness(arrayCount, { inputs: { array: loopOf([[1], [1, 2], []]) } }).step().outputs.count).toEqual(loopOf([1, 2, 0]));
  });
});
