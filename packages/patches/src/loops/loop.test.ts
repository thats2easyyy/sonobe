import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopItems, loopOf } from "../infra/index.ts";
import { loopPatch } from "./loop.ts";

const messages = (h: { logs: { message: string }[] }) => h.logs.map((l) => l.message);

describe("loop", () => {
  it("makes indices 0 … Count − 1, defaulting to 3", () => {
    const h = createPatchHarness(loopPatch);
    expect(h.step().outputs.index).toEqual(loopOf([0, 1, 2]));
    expect(h.step({ inputs: { count: 5 } }).outputs.index).toEqual(loopOf([0, 1, 2, 3, 4]));
    expect(h.logs).toEqual([]);
  });

  it("rounds down, and makes an empty loop for 0 or less without warning", () => {
    const h = createPatchHarness(loopPatch, { inputs: { count: 2.9 } });
    expect(h.step().outputs.index).toEqual(loopOf([0, 1]));
    expect(h.step({ inputs: { count: 0 } }).outputs.index).toEqual(loopOf([]));
    expect(h.step({ inputs: { count: -4 } }).outputs.index).toEqual(loopOf([]));
    expect(h.step({ inputs: { count: -Infinity } }).outputs.index).toEqual(loopOf([]));
    expect(h.logs).toEqual([]);
  });

  it("warns once when Count isn't a number", () => {
    const h = createPatchHarness(loopPatch, { inputs: { count: Number.NaN } });
    expect(h.run(3).outputs.index).toEqual(loopOf([]));
    expect(messages(h)).toEqual(["Loop: Count isn't a number, so the loop is empty."]);
  });

  it("caps Count at 10,000 with one warning", () => {
    const h = createPatchHarness(loopPatch, { inputs: { count: Infinity } });
    const items = loopItems(h.step().outputs.index);
    expect(items).toHaveLength(10_000);
    expect(items[9_999]).toBe(9_999);
    h.step({ inputs: { count: 20_000 } });
    expect(messages(h)).toEqual(["Loop: Count is capped at 10,000 items."]);
  });

  it("reads item 0 of a looped Count and warns once", () => {
    const h = createPatchHarness(loopPatch, { inputs: { count: loopOf([2, 7]) } });
    expect(h.run(2).outputs.index).toEqual(loopOf([0, 1]));
    expect(messages(h)).toEqual(["Loop: Count takes one number, so only the first item of the loop is used."]);
  });

  it("warns again after a restart", () => {
    const h = createPatchHarness(loopPatch, { inputs: { count: Number.NaN } });
    h.run(2);
    h.restart();
    h.step();
    expect(h.logs).toHaveLength(2);
  });

  it("changes the loop on the same frame in the runtime", () => {
    const result = runPatch(loopPatch, [{}, { count: 4 }, { count: 1 }, { count: 0 }]);
    expect(result.frames.map((f) => f.outputs.index)).toEqual([loopOf([0, 1, 2]), loopOf([0, 1, 2, 3]), loopOf([0]), loopOf([])]);
    expect(result.issues).toEqual([]);
  });
});
