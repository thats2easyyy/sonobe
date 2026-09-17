import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { subarray } from "./subarray.ts";

const numbers = [0, 1, 2, 3, 4, 5];
const slice = (inputs: Record<string, unknown>) => createPatchHarness(subarray, { inputs: { array: numbers, ...inputs } }).step().outputs.output;

describe("subarray", () => {
  it("takes Length elements from Start, cut at the end", () => {
    expect(slice({})).toEqual([0, 1, 2]);
    expect(slice({ start: 1, length: 3 })).toEqual([1, 2, 3]);
    expect(slice({ start: 4, length: 10 })).toEqual([4, 5]);
  });

  it("gives [] for Length ≤ 0, non-finite Length, or Start past the end", () => {
    expect(slice({ length: 0 })).toEqual([]);
    expect(slice({ length: -2 })).toEqual([]);
    expect(slice({ length: Number.NaN })).toEqual([]);
    expect(slice({ start: 6 })).toEqual([]);
  });

  it("keeps float noise at whole numbers and never counts Start from the end", () => {
    expect(slice({ length: 4.9999999999999996 })).toEqual([0, 1, 2, 3, 4]);
    expect(slice({ start: -2, length: 2 })).toEqual([0, 1]);
  });

  it("builds a new array", () => {
    const input = [1, 2];
    expect(createPatchHarness(subarray, { inputs: { array: input } }).step().outputs.output).not.toBe(input);
  });

  it("outputs [] for non-arrays with one warning", () => {
    const h = createPatchHarness(subarray, { inputs: { array: "abc" } });
    expect(h.step().outputs.output).toEqual([]);
    h.step();
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("gives a loop of pages for looped starts", () => {
    expect(slice({ start: loopOf([0, 3]), length: 3 })).toEqual(
      loopOf([
        [0, 1, 2],
        [3, 4, 5],
      ]),
    );
  });
});
