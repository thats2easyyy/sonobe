import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { loopOverArrayPatch } from "./loopOverArray.ts";

describe("loopOverArray", () => {
  it("makes one item per element with matching indices", () => {
    const h = createPatchHarness(loopOverArrayPatch, { inputs: { array: ["Ada", "Grace", "Linus"] } });
    expect(h.step().outputs).toEqual({ items: loopOf(["Ada", "Grace", "Linus"]), index: loopOf([0, 1, 2]) });
  });

  it("keeps nested arrays and objects as single items", () => {
    const h = createPatchHarness(loopOverArrayPatch, { inputs: { array: [[1, 2], [3], { name: "Ada" }] } });
    expect(h.step().outputs.items).toEqual(loopOf([[1, 2], [3], { name: "Ada" }]));
  });

  it("gives empty loops for the default, [] and null", () => {
    const h = createPatchHarness(loopOverArrayPatch);
    expect(h.step().outputs).toEqual({ items: loopOf([]), index: loopOf([]) });
    expect(h.step({ inputs: { array: [] } }).outputs.items).toEqual(loopOf([]));
    expect(h.step({ inputs: { array: null } }).outputs.items).toEqual(loopOf([]));
    expect(h.logs).toEqual([]);
  });

  it("gives a one-item loop for any other single value", () => {
    const h = createPatchHarness(loopOverArrayPatch, { inputs: { array: 7 } });
    expect(h.step().outputs.items).toEqual(loopOf([7]));
    expect(h.step({ inputs: { array: "hello" } }).outputs.items).toEqual(loopOf(["hello"]));
    expect(h.logs).toEqual([]);
  });

  it("warns once for an object and once for text that looks like JSON", () => {
    const h = createPatchHarness(loopOverArrayPatch, { inputs: { array: { results: [1, 2] } } });
    expect(h.run(2).outputs.items).toEqual(loopOf([{ results: [1, 2] }]));
    expect(h.run(2, { inputs: { array: "  [1, 2]" } }).outputs.items).toEqual(loopOf(["  [1, 2]"]));
    expect(h.logs.map((l) => l.message)).toEqual([
      "Loop Over Array got an object, not an array. Use Value for Key to pick the array inside it.",
      "Loop Over Array got text that looks like JSON. Convert it with Text to JSON first.",
    ]);
  });

  it("joins a looped Array one level deep", () => {
    const h = createPatchHarness(loopOverArrayPatch, { inputs: { array: loopOf([[1, 2], null, 3, [[4]]]) } });
    expect(h.step().outputs).toEqual({ items: loopOf([1, 2, 3, [4]]), index: loopOf([0, 1, 2, 3]) });
  });

  it("follows a new array on the same frame in the runtime", () => {
    const result = runPatch(loopOverArrayPatch, [{}, { array: { json: ["a", "b"] } }, { array: { json: null } }]);
    expect(result.frames.map((f) => f.outputs.items)).toEqual([loopOf([]), loopOf(["a", "b"]), loopOf([])]);
  });

  it("outputs empty loops while muted", () => {
    expect(loopOverArrayPatch.mutedBehavior).toBe("zero");
    const result = runPatch(loopOverArrayPatch, [{ array: { json: [1, 2] } }], { muted: true });
    expect(result.frames[0]!.outputs).toEqual({ items: loopOf([]), index: loopOf([]) });
  });
});
