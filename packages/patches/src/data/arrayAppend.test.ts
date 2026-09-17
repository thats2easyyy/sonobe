import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { MAX_APPENDED_ITEMS, arrayAppend } from "./arrayAppend.ts";

describe("arrayAppend", () => {
  it("appends Item on each Append pulse, including consecutive frames", () => {
    const h = createPatchHarness(arrayAppend, { typeParam: "text", inputs: { array: ["a"], item: "b" } });
    expect(h.step().outputs.output).toEqual(["a"]);
    expect(h.step({ pulses: ["append"] }).outputs.output).toEqual(["a", "b"]);
    expect(h.step({ pulses: ["append"], inputs: { item: "c" } }).outputs.output).toEqual(["a", "b", "c"]);
    expect(h.step().outputs.output).toEqual(["a", "b", "c"]);
  });

  it("appends on frame 0 and once for a held true boolean", () => {
    const h = createPatchHarness(arrayAppend, { inputs: { append: true, item: 1 } });
    expect(h.step().outputs.output).toEqual([1]);
    expect(h.step().outputs.output).toEqual([1]);
    h.step({ inputs: { append: false } });
    expect(h.step({ inputs: { append: true } }).outputs.output).toEqual([1, 1]);
  });

  it("applies Reset before Append on the same frame", () => {
    const h = createPatchHarness(arrayAppend, { typeParam: "text", inputs: { array: ["a"], item: "b" } });
    h.step({ pulses: ["append"] });
    h.step({ pulses: ["append"] });
    expect(h.step({ pulses: ["reset", "append"], inputs: { item: "z" } }).outputs.output).toEqual(["a", "z"]);
    expect(h.step({ pulses: ["reset"] }).outputs.output).toEqual(["a"]);
  });

  it("clears appended items when Array changes by value, but not for an equal copy", () => {
    const h = createPatchHarness(arrayAppend, { typeParam: "text", inputs: { array: ["a"], item: "b" } });
    h.step({ pulses: ["append"] });
    expect(h.step({ inputs: { array: ["a"] } }).outputs.output).toEqual(["a", "b"]);
    expect(h.step({ inputs: { array: ["q"] } }).outputs.output).toEqual(["q"]);
  });

  it("doesn't duplicate items fed back into Array", () => {
    const h = createPatchHarness(arrayAppend, { typeParam: "text", inputs: { array: [], item: "x" } });
    const out = h.step({ pulses: ["append"] }).outputs.output as unknown[];
    expect(h.step({ inputs: { array: [...out] } }).outputs.output).toEqual(["x"]);
    expect(h.step({ pulses: ["append"], inputs: { item: "y" } }).outputs.output).toEqual(["x", "y"]);
  });

  it("captures Item on the pulse frame and keeps the output's identity until it changes", () => {
    const h = createPatchHarness(arrayAppend, { typeParam: "color", inputs: { item: "#FF0000FF" } });
    const first = h.step({ pulses: ["append"] }).outputs.output;
    expect(first).toEqual(["#FF0000FF"]);
    expect(h.step({ inputs: { item: "#00FF00FF" } }).outputs.output).toBe(first);
  });

  it("keeps a list per loop index", () => {
    const h = createPatchHarness(arrayAppend, { typeParam: "text", inputs: { item: loopOf(["x", "y"]) } });
    h.step({ pulses: ["append"] });
    expect(h.step({ pulses: ["append"] }).outputs.output).toEqual(loopOf([["x", "x"], ["y", "y"]]));
  });

  it("counts a non-array Array as []", () => {
    const h = createPatchHarness(arrayAppend, { inputs: { array: { a: 1 }, item: 4 } });
    expect(h.step({ pulses: ["append"] }).outputs.output).toEqual([4]);
  });

  it("ignores appends past 10,000 items with one warning", () => {
    const h = createPatchHarness(arrayAppend);
    h.step();
    h.state()!.items = new Array<unknown>(MAX_APPENDED_ITEMS).fill(0);
    h.step({ pulses: ["append"] });
    h.step({ pulses: ["append"] });
    expect(h.state()!.items).toHaveLength(MAX_APPENDED_ITEMS);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("passes Array through and never appends while muted", () => {
    const run = runPatch(arrayAppend, [{ array: [1], append: true }, { append: true }], { muted: true });
    expect(run.frames.map((f) => f.outputs.output)).toEqual([[1], [1]]);
  });
});
