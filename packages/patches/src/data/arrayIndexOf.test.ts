import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { arrayIndexOf } from "./arrayIndexOf.ts";

describe("arrayIndexOf", () => {
  it("finds the first matching position", () => {
    const h = createPatchHarness(arrayIndexOf, { typeParam: "text", inputs: { array: ["a", "b", "a"], item: "a" } });
    expect(h.step().outputs).toEqual({ index: 0, contains: true });
    expect(h.step({ inputs: { item: "c" } }).outputs).toEqual({ index: -1, contains: false });
  });

  it("never matches across kinds", () => {
    const h = createPatchHarness(arrayIndexOf, { typeParam: "json", inputs: { array: ["3", 1, true], item: 3 } });
    expect(h.step().outputs.index).toBe(-1);
    expect(h.step({ inputs: { item: "3" } }).outputs.index).toBe(0);
    expect(h.step({ inputs: { item: true } }).outputs.index).toBe(2);
  });

  it("matches colors as hex text and objects in any key order", () => {
    expect(createPatchHarness(arrayIndexOf, { typeParam: "color", inputs: { array: ["#00000000", "#FF0000FF"], item: { r: 1, g: 0, b: 0, a: 1 } } }).step().outputs.index).toBe(1);
    expect(createPatchHarness(arrayIndexOf, { typeParam: "json", inputs: { array: [{ a: 1, b: 2 }], item: { b: 2, a: 1 } } }).step().outputs.index).toBe(0);
    expect(createPatchHarness(arrayIndexOf, { typeParam: "point", inputs: { array: [[1, 2]], item: [1, 2] } }).step().outputs.contains).toBe(true);
  });

  it("outputs −1 and false for non-arrays", () => {
    const h = createPatchHarness(arrayIndexOf, { inputs: { array: { 0: 0 }, item: 0 } });
    expect(h.step().outputs).toEqual({ index: -1, contains: false });
    expect(h.logs).toEqual([]);
  });

  it("gives one position per looped item", () => {
    const f = createPatchHarness(arrayIndexOf, { typeParam: "text", inputs: { array: ["a", "b"], item: loopOf(["b", "z"]) } }).step();
    expect(f.outputs.index).toEqual(loopOf([1, -1]));
    expect(f.outputs.contains).toEqual(loopOf([true, false]));
  });

  it("outputs −1 and false while muted", () => {
    const run = runPatch(arrayIndexOf, [{ array: [5], item: 5 }], { muted: true, typeParam: "index" });
    expect(run.frames[0]!.outputs).toEqual({ index: -1, contains: false });
  });
});
