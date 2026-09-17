import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { loopReversePatch } from "./loopReverse.ts";

describe("loopReverse", () => {
  it("puts the last item first and keeps the count", () => {
    const h = createPatchHarness(loopReversePatch, { typeParam: "text", inputs: { loop: loopOf(["a", "b", "c"]) } });
    expect(h.step().outputs.output).toEqual(loopOf(["c", "b", "a"]));
  });

  it("gives an empty loop for an empty loop and a one-item loop for a single value", () => {
    const h = createPatchHarness(loopReversePatch);
    expect(h.step().outputs.output).toEqual(loopOf([]));
    expect(h.step({ inputs: { loop: 5 } }).outputs.output).toEqual(loopOf([5]));
  });

  it("passes items through unchanged", () => {
    const point = [1, 2];
    const h = createPatchHarness(loopReversePatch, { typeParam: "point", inputs: { loop: loopOf([point, [3, 4]]) } });
    const out = h.step().outputs.output as { items: unknown[] };
    expect(out.items[1]).toBe(point);
  });

  it("passes Loop through in its original order while muted", () => {
    const result = runPatch(loopReversePatch, [{ loop: loopOf([1, 2, 3]) }], { muted: true });
    expect(result.frames[0]!.outputs.output).toEqual(loopOf([1, 2, 3]));
  });
});
