import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopItems, loopOf } from "../infra/index.ts";
import { loopRemovePatch, replayRemovals } from "./loopRemove.ts";

const abcd = loopOf(["a", "b", "c", "d"]);

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

describe("loopRemove", () => {
  it("removes the item at Index on each pulse and closes up positions", () => {
    const h = createPatchHarness(loopRemovePatch, { typeParam: "text", inputs: { loop: abcd } });
    expect(h.step().outputs.output).toEqual(abcd);
    expect(h.step({ pulses: ["remove"] }).outputs).toEqual({ output: loopOf(["b", "c", "d"]), outputIndex: loopOf([0, 1, 2]) });
    expect(h.step({ pulses: ["remove"] }).outputs.output).toEqual(loopOf(["c", "d"]));
    expect(h.run(3).outputs.output).toEqual(loopOf(["c", "d"]));
  });

  it("re-reads Index on each pulse", () => {
    const h = createPatchHarness(loopRemovePatch, { typeParam: "text", inputs: { loop: abcd, index: 1 } });
    expect(h.step({ pulses: ["remove"] }).outputs.output).toEqual(loopOf(["a", "c", "d"]));
    expect(h.step({ inputs: { index: 2 }, pulses: ["remove"] }).outputs.output).toEqual(loopOf(["a", "c"]));
  });

  it("does nothing and stores nothing for a position past the end or an empty loop", () => {
    const h = createPatchHarness(loopRemovePatch, { typeParam: "text", inputs: { loop: abcd, index: 4 } });
    expect(h.step({ pulses: ["remove"] }).outputs.output).toEqual(abcd);
    expect(h.state()!.removals).toEqual([]);
    const empty = createPatchHarness(loopRemovePatch);
    expect(empty.step({ pulses: ["remove"] }).outputs).toEqual({ output: loopOf([]), outputIndex: loopOf([]) });
    expect(empty.state()!.removals).toEqual([]);
  });

  it("re-applies removals to a new loop, skipping positions past the end until it grows back", () => {
    const h = createPatchHarness(loopRemovePatch, { typeParam: "text", inputs: { loop: loopOf(["a", "b", "c"]), index: 2 } });
    expect(h.step({ pulses: ["remove"] }).outputs.output).toEqual(loopOf(["a", "b"]));
    expect(h.step({ inputs: { loop: loopOf(["p", "q"]) } }).outputs.output).toEqual(loopOf(["p", "q"]));
    expect(h.step({ inputs: { loop: loopOf(["p", "q", "r", "s"]) } }).outputs.output).toEqual(loopOf(["p", "q", "s"]));
  });

  it("resets first, so Reset and Remove in one frame gives Loop minus the new removal", () => {
    const h = createPatchHarness(loopRemovePatch, { typeParam: "text", inputs: { loop: abcd } });
    h.step({ pulses: ["remove"] });
    h.step({ pulses: ["remove"] });
    expect(h.step({ inputs: { index: 3 }, pulses: ["reset", "remove"] }).outputs.output).toEqual(loopOf(["a", "b", "c"]));
    expect(h.step({ pulses: ["reset"] }).outputs.output).toEqual(abcd);
  });

  it("applies a pulse on frame 0", () => {
    const h = createPatchHarness(loopRemovePatch, { inputs: { loop: loopOf([1, 2]) } });
    expect(h.step({ pulses: ["remove"] }).outputs.output).toEqual(loopOf([2]));
  });

  it("reads item 0 of a looped Index and warns once", () => {
    const h = createPatchHarness(loopRemovePatch, { inputs: { loop: loopOf([1, 2, 3]), index: loopOf([2, 0]) } });
    expect(h.step({ pulses: ["remove"] }).outputs.output).toEqual(loopOf([1, 2]));
    h.step({ pulses: ["remove"] });
    expect(h.logs.map((l) => l.message)).toEqual(["Loop Remove: Index, Remove, and Reset take single values, so only item 0 of a looped input is used."]);
  });

  it("forgets removals when the patch's type changes and on restart", () => {
    const h = createPatchHarness(loopRemovePatch, { inputs: { loop: loopOf([1, 2]) } });
    h.step({ pulses: ["remove"] });
    h.state()!.variant = "text";
    expect(h.step().outputs.output).toEqual(loopOf([1, 2]));
    h.step({ pulses: ["remove"] });
    h.restart();
    expect(h.step().outputs.output).toEqual(loopOf([1, 2]));
  });

  it("matches a naive replay across random edits", () => {
    const random = lcg(19);
    let source = [0, 1, 2, 3, 4, 5, 6];
    let removals: number[] = [];
    const h = createPatchHarness(loopRemovePatch, { inputs: { loop: loopOf(source) } });
    for (let frame = 0; frame < 300; frame++) {
      const inputs: Record<string, unknown> = { index: Math.floor(random() * 8) };
      const pulses: string[] = [];
      if (random() < 0.2) inputs.loop = loopOf((source = Array.from({ length: Math.floor(random() * 9) }, (_, i) => i * 10)));
      if (random() < 0.05) {
        pulses.push("reset");
        removals = [];
      }
      const expected = [...source];
      for (const at of removals) if (at < expected.length) expected.splice(at, 1);
      if (random() < 0.4) {
        pulses.push("remove");
        const at = inputs.index as number;
        if (at < expected.length) {
          removals.push(at);
          expected.splice(at, 1);
        }
      }
      expect(loopItems(h.step({ inputs, pulses }).outputs.output), `frame ${frame}`).toEqual(expected);
    }
  });

  it("outputs Loop unchanged and ignores pulses while muted", () => {
    expect(loopRemovePatch.mutedBehavior).toBe("evaluate");
    const result = runPatch(loopRemovePatch, [{ loop: loopOf([1, 2, 3]), remove: true }], { muted: true });
    expect(result.frames[0]!.outputs).toEqual({ output: loopOf([1, 2, 3]), outputIndex: loopOf([0, 1, 2]) });
  });

  it("removes in the runtime", () => {
    const result = runPatch(loopRemovePatch, [{ loop: { loop: ["a", "b", "c"] }, index: 1, remove: true }, { remove: true }, {}], { typeParam: "text" });
    expect(result.frames.map((f) => f.outputs.output)).toEqual([loopOf(["a", "c"]), loopOf(["a"]), loopOf(["a"])]);
  });
});

describe("replayRemovals", () => {
  it("applies removals in order and skips positions past the end", () => {
    expect(replayRemovals(["a", "b", "c", "d"], [0, 0, 5, 1])).toEqual(["c"]);
    expect(replayRemovals(["a", "b", "c"], [2, 2, 0])).toEqual(["b"]);
  });
});
