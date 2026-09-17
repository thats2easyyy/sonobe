import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { MAX_JOINED_ELEMENTS, arrayJoin } from "./arrayJoin.ts";

describe("arrayJoin", () => {
  it("joins arrays in port order without flattening nested arrays", () => {
    const h = createPatchHarness(arrayJoin, { inputs: { array1: [1, [2]], array2: [3, 1] } });
    expect(h.step().outputs.array).toEqual([1, [2], 3, 1]);
    expect(createPatchHarness(arrayJoin).step().outputs.array).toEqual([]);
  });

  it("adds single values as one element and skips null", () => {
    const h = createPatchHarness(arrayJoin, { inputCount: 3, inputs: { array1: "a", array2: null, array3: { k: 1 } } });
    expect(h.step().outputs.array).toEqual(["a", { k: 1 }]);
  });

  it("never mutates inputs", () => {
    const first = [1];
    const out = createPatchHarness(arrayJoin, { inputs: { array1: first, array2: [2] } }).step().outputs.array;
    expect(first).toEqual([1]);
    expect(out).not.toBe(first);
  });

  it("keeps the first 10,000 elements with one warning", () => {
    const h = createPatchHarness(arrayJoin, { inputs: { array1: new Array<number>(6000).fill(1), array2: new Array<number>(6000).fill(2) } });
    const out = h.step().outputs.array as number[];
    expect(out).toHaveLength(MAX_JOINED_ELEMENTS);
    expect(out[5999]).toBe(1);
    expect(out[9999]).toBe(2);
    h.step();
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("zips looped inputs into a loop of joined arrays", () => {
    const h = createPatchHarness(arrayJoin, { inputs: { array1: loopOf([[1], [2]]), array2: [0] } });
    expect(h.step().outputs.array).toEqual(
      loopOf([
        [1, 0],
        [2, 0],
      ]),
    );
  });

  it("passes Array 1 through while muted", () => {
    expect(runPatch(arrayJoin, [{ array1: [1], array2: [2] }], { muted: true }).frames[0]!.outputs.array).toEqual([1]);
  });
});
