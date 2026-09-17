import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { loopToArrayPatch } from "./loopToArray.ts";

describe("loopToArray", () => {
  it("packs items in order using the document encoding", () => {
    const loop = loopOf([1, "a", true, null, { r: 1, g: 0, b: 0, a: 1 }, [1, 2], { layerId: "card", instance: 2 }]);
    const h = createPatchHarness(loopToArrayPatch, { inputs: { loop } });
    expect(h.step().outputs.array).toEqual([1, "a", true, null, "#FF0000FF", [1, 2], { layerId: "card", instance: 2 }]);
  });

  it("converts nested loops and colors inside objects", () => {
    const gradient = { kind: "linear", stops: [{ offset: 0, color: { r: 0, g: 0, b: 0, a: 1 } }], start: [0, 0], end: [0, 1] };
    const h = createPatchHarness(loopToArrayPatch, { inputs: { loop: loopOf([loopOf([1, 2]), gradient]) } });
    expect(h.step().outputs.array).toEqual([[1, 2], { kind: "linear", stops: [{ offset: 0, color: "#000000FF" }], start: [0, 0], end: [0, 1] }]);
  });

  it("writes non-finite numbers as 0 with one warning", () => {
    const h = createPatchHarness(loopToArrayPatch, { inputs: { loop: loopOf([Number.NaN, [1, Infinity]]) } });
    expect(h.run(2).outputs.array).toEqual([0, [1, 0]]);
    expect(h.logs.map((l) => l.message)).toEqual(["Loop to Array: a number wasn't finite, so it was written as 0."]);
  });

  it("gives [] for an empty loop and a one-element array for a single value", () => {
    const h = createPatchHarness(loopToArrayPatch);
    expect(h.step().outputs.array).toEqual([]);
    expect(h.step({ inputs: { loop: 5 } }).outputs.array).toEqual([5]);
  });

  it("makes a fresh deep copy every frame", () => {
    const item = { tags: ["a"] };
    const h = createPatchHarness(loopToArrayPatch, { inputs: { loop: loopOf([item]) } });
    const first = h.step().outputs.array as { tags: string[] }[];
    const second = h.step().outputs.array as { tags: string[] }[];
    expect(second).not.toBe(first);
    expect(first[0]).not.toBe(item);
    expect(first[0]!.tags).not.toBe(item.tags);
  });

  it("outputs null while muted", () => {
    const result = runPatch(loopToArrayPatch, [{ loop: loopOf([1, 2]) }], { muted: true });
    expect(result.frames[0]!.outputs.array).toBeNull();
  });
});
