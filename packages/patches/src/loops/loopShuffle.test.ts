import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopItems, loopOf } from "../infra/index.ts";
import { fisherYates, fitOrder, loopShufflePatch } from "./loopShuffle.ts";

const colors = loopOf(["red", "green", "blue", "yellow"]);
/** random() that always draws the top of the range, so Fisher–Yates returns the identity. */
const alwaysHigh = { random: () => 0.999999 };

describe("loopShuffle", () => {
  it("keeps the original order until Shuffle fires", () => {
    const h = createPatchHarness(loopShufflePatch, { typeParam: "text", inputs: { loop: colors } });
    expect(h.run(3).outputs.output).toEqual(colors);
  });

  it("picks a new order on each pulse and holds it between pulses", () => {
    const h = createPatchHarness(loopShufflePatch, { typeParam: "text", inputs: { loop: colors }, seed: 3 });
    h.step();
    const first = loopItems(h.step({ pulses: ["shuffle"] }).outputs.output);
    expect([...first].sort()).toEqual([...colors.items].sort());
    expect(first).not.toEqual(colors.items);
    expect(loopItems(h.run(5).outputs.output)).toEqual(first);
    const second = loopItems(h.step({ pulses: ["shuffle"] }).outputs.output);
    expect(second).not.toEqual(first);
  });

  it("repeats exactly for the same seed", () => {
    const run = () => {
      const h = createPatchHarness(loopShufflePatch, { typeParam: "text", inputs: { loop: colors }, seed: 11 });
      return [1, 2, 3].map(() => loopItems(h.step({ pulses: ["shuffle"] }).outputs.output));
    };
    expect(run()).toEqual(run());
  });

  it("always changes the order of two items", () => {
    const h = createPatchHarness(loopShufflePatch, { inputs: { loop: loopOf([1, 2]) } });
    const orders = [1, 2, 3, 4].map(() => loopItems(h.step({ pulses: ["shuffle"] }).outputs.output));
    expect(orders).toEqual([[2, 1], [1, 2], [2, 1], [1, 2]]);
  });

  it("swaps the first two items when 16 draws repeat the current order", () => {
    const h = createPatchHarness(loopShufflePatch, { typeParam: "text", inputs: { loop: colors }, services: alwaysHigh });
    expect(h.step({ pulses: ["shuffle"] }).outputs.output).toEqual(loopOf(["green", "red", "blue", "yellow"]));
    expect(h.step({ pulses: ["shuffle"] }).outputs.output).toEqual(colors);
  });

  it("resets to the original order, and Reset plus Shuffle in one frame shuffles fresh", () => {
    const h = createPatchHarness(loopShufflePatch, { typeParam: "text", inputs: { loop: colors }, services: alwaysHigh });
    h.step({ pulses: ["shuffle"] });
    expect(h.step({ pulses: ["reset"] }).outputs.output).toEqual(colors);
    h.step({ pulses: ["shuffle"] });
    expect(h.step({ pulses: ["reset", "shuffle"] }).outputs.output).toEqual(loopOf(["green", "red", "blue", "yellow"]));
  });

  it("does nothing and stores nothing for 0 or 1 items", () => {
    const h = createPatchHarness(loopShufflePatch, { typeParam: "text", inputs: { loop: loopOf(["only"]) } });
    expect(h.step({ pulses: ["shuffle"] }).outputs.output).toEqual(loopOf(["only"]));
    expect(h.state()!.order).toBeNull();
    expect(h.step({ inputs: { loop: loopOf([]) }, pulses: ["shuffle"] }).outputs.output).toEqual(loopOf([]));
  });

  it("keeps shuffled places when values change and fits count changes", () => {
    const h = createPatchHarness(loopShufflePatch, { typeParam: "text", inputs: { loop: colors }, services: alwaysHigh });
    h.step({ pulses: ["shuffle"] });
    expect(h.step({ inputs: { loop: loopOf(["R", "G", "B", "Y"]) } }).outputs.output).toEqual(loopOf(["G", "R", "B", "Y"]));
    expect(h.step({ inputs: { loop: loopOf(["a", "b"]) } }).outputs.output).toEqual(loopOf(["b", "a"]));
    expect(h.step({ inputs: { loop: loopOf(["a", "b", "c", "d", "e"]) } }).outputs.output).toEqual(loopOf(["b", "a", "c", "d", "e"]));
  });

  it("applies a Shuffle pulse on frame 0", () => {
    const h = createPatchHarness(loopShufflePatch, { typeParam: "text", inputs: { loop: colors }, services: alwaysHigh });
    expect(h.step({ pulses: ["shuffle"] }).outputs.output).not.toEqual(colors);
  });

  it("returns to the original order when the patch's type changes", () => {
    const h = createPatchHarness(loopShufflePatch, { inputs: { loop: loopOf([1, 2, 3]) }, services: alwaysHigh });
    expect(h.step({ pulses: ["shuffle"] }).outputs.output).toEqual(loopOf([2, 1, 3]));
    h.state()!.variant = "text";
    expect(h.step().outputs.output).toEqual(loopOf([1, 2, 3]));
  });

  it("listens to item 0 of a looped Shuffle and warns once", () => {
    const h = createPatchHarness(loopShufflePatch, { inputs: { loop: loopOf([1, 2]), shuffle: loopOf([false, true]) } });
    expect(h.step().outputs.output).toEqual(loopOf([1, 2]));
    expect(h.step({ inputs: { shuffle: loopOf([true, false]) } }).outputs.output).toEqual(loopOf([2, 1]));
    expect(h.logs.map((l) => l.message)).toEqual([
      "Loop Shuffle: Shuffle and Reset listen to one pulse, so only item 0 of a looped input counts. Combine looped pulses with Any first.",
    ]);
  });

  it("goes back to the original order on restart", () => {
    const h = createPatchHarness(loopShufflePatch, { inputs: { loop: loopOf([1, 2]) } });
    h.step({ pulses: ["shuffle"] });
    h.restart();
    expect(h.step().outputs.output).toEqual(loopOf([1, 2]));
  });

  it("passes Loop through in original order while muted", () => {
    const result = runPatch(loopShufflePatch, [{ loop: loopOf([1, 2, 3]), shuffle: true }], { muted: true });
    expect(result.frames[0]!.outputs.output).toEqual(loopOf([1, 2, 3]));
  });

  it("shuffles in the runtime with the seeded random service", () => {
    const frames = (seed: number) => runPatch(loopShufflePatch, [{ loop: loopOf([1, 2, 3, 4, 5]) }, { shuffle: true }, {}], { seed }).frames.map((f) => f.outputs.output);
    const a = frames(5);
    expect(a[0]).toEqual(loopOf([1, 2, 3, 4, 5]));
    expect(a[1]).not.toEqual(a[0]);
    expect(a[2]).toEqual(a[1]);
    expect(frames(5)).toEqual(a);
  });
});

describe("fitOrder and fisherYates", () => {
  it("keeps surviving positions in stored order and appends missing ones", () => {
    expect(fitOrder(null, 3)).toEqual([0, 1, 2]);
    expect(fitOrder([3, 1, 0, 2], 3)).toEqual([1, 0, 2]);
    expect(fitOrder([2, 0], 4)).toEqual([2, 0, 1, 3]);
    expect(fitOrder([1, 0], 0)).toEqual([]);
  });

  it("returns a permutation", () => {
    let s = 1;
    const random = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 12; n++) expect([...fisherYates(n, random)].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
  });
});
