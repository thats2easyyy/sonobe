import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { arrayReverse } from "./arrayReverse.ts";

describe("arrayReverse", () => {
  it("reverses a copy, keeping nested arrays in order", () => {
    const input = [1, [2, 3], "x"];
    const h = createPatchHarness(arrayReverse, { inputs: { array: input } });
    expect(h.step().outputs.output).toEqual(["x", [2, 3], 1]);
    expect(input).toEqual([1, [2, 3], "x"]);
  });

  it("outputs [] for null silently and warns once for other values", () => {
    const quiet = createPatchHarness(arrayReverse, { inputs: { array: null } });
    expect(quiet.step().outputs.output).toEqual([]);
    expect(quiet.logs).toEqual([]);
    const loud = createPatchHarness(arrayReverse, { inputs: { array: { a: 1 } } });
    expect(loud.step().outputs.output).toEqual([]);
    loud.step();
    expect(loud.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("reverses each array of a loop, not the loop", () => {
    expect(createPatchHarness(arrayReverse, { inputs: { array: loopOf([[1, 2], [3]]) } }).step().outputs.output).toEqual(loopOf([[2, 1], [3]]));
  });
});
