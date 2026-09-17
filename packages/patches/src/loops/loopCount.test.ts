import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { loopCountPatch } from "./loopCount.ts";

describe("loopCount", () => {
  it("counts items: 0 unconnected, 1 for a single value", () => {
    const h = createPatchHarness(loopCountPatch);
    expect(h.step().outputs.count).toBe(0);
    expect(h.step({ inputs: { loop: loopOf(["a", "b", "c", "d"]) } }).outputs.count).toBe(4);
    expect(h.step({ inputs: { loop: 7 } }).outputs.count).toBe(1);
    expect(h.step({ inputs: { loop: loopOf([]) } }).outputs.count).toBe(0);
  });

  it("counts null items and any item type", () => {
    const h = createPatchHarness(loopCountPatch, { inputs: { loop: loopOf([null, { layerId: "card" }, true]) } });
    expect(h.step().outputs.count).toBe(3);
  });

  it("uses the empty-loop default in the runtime", () => {
    const result = runPatch(loopCountPatch, [{}, { loop: loopOf([1, 2, 3]) }]);
    expect(result.frames.map((f) => f.outputs.count)).toEqual([0, 3]);
  });
});
