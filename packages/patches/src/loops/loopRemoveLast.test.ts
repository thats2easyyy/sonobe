import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { loopRemoveLastPatch } from "./loopRemoveLast.ts";

describe("loopRemoveLast", () => {
  it("takes one item off the end per pulse", () => {
    const h = createPatchHarness(loopRemoveLastPatch, { typeParam: "text", inputs: { loop: loopOf(["a", "b", "c"]) } });
    expect(h.step().outputs.output).toEqual(loopOf(["a", "b", "c"]));
    expect(h.step({ pulses: ["removeLast"] }).outputs).toEqual({ output: loopOf(["a", "b"]), index: loopOf([0, 1]) });
    expect(h.run(2).outputs.output).toEqual(loopOf(["a", "b"]));
    expect(h.step({ pulses: ["removeLast"] }).outputs.output).toEqual(loopOf(["a"]));
  });

  it("ignores pulses on an empty result, so later items aren't removed", () => {
    const h = createPatchHarness(loopRemoveLastPatch, { inputs: { loop: loopOf([1]) } });
    h.step({ pulses: ["removeLast"] });
    expect(h.step({ pulses: ["removeLast"] }).outputs.output).toEqual(loopOf([]));
    expect(h.state()!.removed).toBe(1);
    expect(h.step({ inputs: { loop: loopOf([1, 2, 3]) } }).outputs.output).toEqual(loopOf([1, 2]));
  });

  it("applies the count to a changing Loop", () => {
    const h = createPatchHarness(loopRemoveLastPatch, { inputs: { loop: loopOf([1, 2, 3]) } });
    h.step({ pulses: ["removeLast"] });
    h.step({ pulses: ["removeLast"] });
    expect(h.step({ inputs: { loop: loopOf([9, 1, 2, 3]) } }).outputs.output).toEqual(loopOf([9, 1]));
    expect(h.step({ inputs: { loop: loopOf([1]) } }).outputs.output).toEqual(loopOf([]));
    expect(h.step({ inputs: { loop: loopOf([1, 2, 3, 4]) } }).outputs.output).toEqual(loopOf([1, 2]));
  });

  it("resets first, so Reset and Remove Last in one frame gives Loop minus its last item", () => {
    const h = createPatchHarness(loopRemoveLastPatch, { inputs: { loop: loopOf([1, 2, 3]) } });
    h.step({ pulses: ["removeLast"] });
    h.step({ pulses: ["removeLast"] });
    expect(h.step({ pulses: ["reset", "removeLast"] }).outputs.output).toEqual(loopOf([1, 2]));
    expect(h.step({ pulses: ["reset"] }).outputs.output).toEqual(loopOf([1, 2, 3]));
  });

  it("applies a pulse on frame 0", () => {
    const h = createPatchHarness(loopRemoveLastPatch, { inputs: { loop: loopOf([1, 2]) } });
    expect(h.step({ pulses: ["removeLast"] }).outputs.output).toEqual(loopOf([1]));
  });

  it("listens to item 0 of a looped Remove Last and warns once", () => {
    const h = createPatchHarness(loopRemoveLastPatch, { inputs: { loop: loopOf([1, 2, 3]), removeLast: loopOf([false, true]) } });
    expect(h.step().outputs.output).toEqual(loopOf([1, 2, 3]));
    expect(h.step({ inputs: { removeLast: loopOf([true, false]) } }).outputs.output).toEqual(loopOf([1, 2]));
    expect(h.logs.map((l) => l.message)).toEqual(["Loop Remove Last: Remove Last and Reset listen to one pulse, so only item 0 of a looped input counts."]);
  });

  it("forgets the count when the patch's type changes and on restart", () => {
    const h = createPatchHarness(loopRemoveLastPatch, { inputs: { loop: loopOf([1, 2]) } });
    h.step({ pulses: ["removeLast"] });
    h.state()!.variant = "text";
    expect(h.step().outputs.output).toEqual(loopOf([1, 2]));
    h.step({ pulses: ["removeLast"] });
    h.restart();
    expect(h.step().outputs.output).toEqual(loopOf([1, 2]));
  });

  it("outputs Loop unchanged and ignores pulses while muted", () => {
    expect(loopRemoveLastPatch.mutedBehavior).toBe("evaluate");
    const result = runPatch(loopRemoveLastPatch, [{ loop: loopOf([1, 2, 3]), removeLast: true }], { muted: true });
    expect(result.frames[0]!.outputs).toEqual({ output: loopOf([1, 2, 3]), index: loopOf([0, 1, 2]) });
  });
});
