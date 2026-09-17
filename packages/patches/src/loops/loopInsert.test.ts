import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopItems, loopOf } from "../infra/index.ts";
import type { HarnessStepOptions } from "../infra/index.ts";
import { clampInsertIndex, loopInsertPatch, replayInserts } from "./loopInsert.ts";

const abc = loopOf(["a", "b", "c"]);

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

describe("loopInsert", () => {
  it("builds a list from an empty loop, one item per pulse", () => {
    const h = createPatchHarness(loopInsertPatch);
    expect(h.step().outputs).toEqual({ output: loopOf([]), outputIndex: loopOf([]) });
    expect(h.step({ inputs: { value: 5 }, pulses: ["insert"] }).outputs).toEqual({ output: loopOf([5]), outputIndex: loopOf([0]) });
    expect(h.step({ inputs: { value: 6 }, pulses: ["insert"] }).outputs.output).toEqual(loopOf([6, 5]));
    expect(h.step({ pulses: ["insert"] }).outputs.output).toEqual(loopOf([6, 6, 5]));
    expect(h.run(3).outputs.output).toEqual(loopOf([6, 6, 5]));
  });

  it("inserts at Index, appending for an index past the end", () => {
    const h = createPatchHarness(loopInsertPatch, { typeParam: "text", inputs: { loop: abc, value: "x", index: 1 } });
    expect(h.step({ pulses: ["insert"] }).outputs).toEqual({ output: loopOf(["a", "x", "b", "c"]), outputIndex: loopOf([0, 1, 2, 3]) });
    expect(h.step({ inputs: { index: 99, value: "z" }, pulses: ["insert"] }).outputs.output).toEqual(loopOf(["a", "x", "b", "c", "z"]));
  });

  it("copies Value on the pulse frame", () => {
    const value = { n: 1 };
    const h = createPatchHarness(loopInsertPatch, { typeParam: "json", inputs: { value } });
    h.step({ pulses: ["insert"] });
    value.n = 2;
    expect(h.step().outputs.output).toEqual(loopOf([{ n: 1 }]));
  });

  it("re-applies stored inserts when Loop changes", () => {
    const h = createPatchHarness(loopInsertPatch, { typeParam: "text", inputs: { loop: abc, value: "x", index: 1 } });
    h.step({ pulses: ["insert"] });
    expect(h.step({ inputs: { loop: loopOf(["p", "q"]) } }).outputs.output).toEqual(loopOf(["p", "x", "q"]));
    expect(h.step({ inputs: { loop: loopOf(["p"]) } }).outputs.output).toEqual(loopOf(["p", "x"]));
    expect(h.step({ inputs: { loop: abc } }).outputs.output).toEqual(loopOf(["a", "x", "b", "c"]));
  });

  it("resets first, so Reset and Insert in one frame gives Loop plus the new item", () => {
    const h = createPatchHarness(loopInsertPatch, { inputs: { value: 1 } });
    h.step({ pulses: ["insert"] });
    h.step({ pulses: ["insert"] });
    expect(h.step({ inputs: { value: 3 }, pulses: ["reset", "insert"] }).outputs.output).toEqual(loopOf([3]));
    expect(h.step({ pulses: ["reset"] }).outputs.output).toEqual(loopOf([]));
  });

  it("applies a pulse on frame 0", () => {
    const h = createPatchHarness(loopInsertPatch, { inputs: { value: 7 } });
    expect(h.step({ pulses: ["insert"] }).outputs.output).toEqual(loopOf([7]));
  });

  it("skips inserts at 10,000 items with one warning", () => {
    const full = loopOf(Array.from({ length: 10_000 }, (_, i) => i));
    const h = createPatchHarness(loopInsertPatch, { inputs: { loop: full } });
    expect(loopItems(h.step({ pulses: ["insert"] }).outputs.output)).toHaveLength(10_000);
    h.step({ pulses: ["insert"] });
    expect(h.logs.map((l) => l.message)).toEqual(["Loop Insert reached 10,000 items, so this insert was skipped."]);
  });

  it("reads item 0 of looped single-value inputs and warns once", () => {
    const h = createPatchHarness(loopInsertPatch, { inputs: { value: loopOf([7, 8]) } });
    expect(h.step({ pulses: ["insert"] }).outputs.output).toEqual(loopOf([7]));
    h.step({ pulses: ["insert"] });
    expect(h.logs.map((l) => l.message)).toEqual(["Loop Insert: Value, Index, Insert, and Reset take single values, so only item 0 of a looped input is used."]);
  });

  it("forgets inserts when the patch's type changes and on restart", () => {
    const h = createPatchHarness(loopInsertPatch, { inputs: { value: 1 } });
    h.step({ pulses: ["insert"] });
    h.state()!.variant = "text";
    expect(h.step().outputs.output).toEqual(loopOf([]));
    h.step({ pulses: ["insert"] });
    h.restart();
    expect(h.step().outputs.output).toEqual(loopOf([]));
  });

  it("matches a naive replay across random edits", () => {
    const random = lcg(7);
    let source = [1, 2, 3];
    let inserts: { at: number; value: number }[] = [];
    const h = createPatchHarness(loopInsertPatch, { inputs: { loop: loopOf(source) } });
    for (let frame = 0; frame < 300; frame++) {
      const inputs: Record<string, unknown> = { index: Math.floor(random() * 8), value: Math.floor(random() * 100) };
      const pulses: string[] = [];
      if (random() < 0.2) inputs.loop = loopOf((source = Array.from({ length: Math.floor(random() * 6) }, () => Math.floor(random() * 10))));
      if (random() < 0.05) {
        pulses.push("reset");
        inserts = [];
      }
      const expected = [...source];
      for (const op of inserts) expected.splice(Math.min(op.at, expected.length), 0, op.value);
      if (random() < 0.4) {
        pulses.push("insert");
        const op = { at: Math.min(inputs.index as number, expected.length), value: inputs.value as number };
        inserts.push(op);
        expected.splice(op.at, 0, op.value);
      }
      const options: HarnessStepOptions = { inputs, pulses };
      expect(loopItems(h.step(options).outputs.output), `frame ${frame}`).toEqual(expected);
    }
  });

  it("outputs Loop unchanged and ignores pulses while muted", () => {
    expect(loopInsertPatch.mutedBehavior).toBe("evaluate");
    const result = runPatch(loopInsertPatch, [{ loop: loopOf([1, 2]), value: 9, insert: true }, { insert: true }], { muted: true });
    expect(result.frames[1]!.outputs).toEqual({ output: loopOf([1, 2]), outputIndex: loopOf([0, 1]) });
    expect((result.states[0] as { inserts: unknown[] }).inserts).toEqual([]);
  });

  it("inserts in the runtime", () => {
    const result = runPatch(loopInsertPatch, [{ loop: { loop: [0, 0] }, value: 5, insert: true }, {}, { value: 6, index: 5, insert: true }]);
    expect(result.frames.map((f) => f.outputs.output)).toEqual([loopOf([5, 0, 0]), loopOf([5, 0, 0]), loopOf([5, 0, 0, 6])]);
    expect(result.issues).toEqual([]);
  });
});

describe("replayInserts", () => {
  it("clamps positions like Option Picker", () => {
    expect(clampInsertIndex(2.9999999999999996, 5)).toBe(3);
    expect(clampInsertIndex(Number.NaN, 5)).toBe(0);
    expect(clampInsertIndex(-1, 5)).toBe(0);
    expect(clampInsertIndex(9, 5)).toBe(5);
    expect(replayInserts(["a"], [{ at: 5, value: "x" }, { at: 0, value: "y" }])).toEqual(["y", "a", "x"]);
  });
});
