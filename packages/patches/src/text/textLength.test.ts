import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { textLengthPatch } from "./textLength.ts";

const length = (text: unknown) => createPatchHarness(textLengthPatch, { inputs: { text } }).step().outputs.length;

describe("textLength", () => {
  it("counts graphemes, not UTF-16 code units", () => {
    expect(length("héllo")).toBe(5);
    expect(length("héllo")).toBe(5);
    expect(length("👍🏽")).toBe(1);
    expect(length("🇯🇵")).toBe(1);
    expect(length("👩‍👩‍👧")).toBe(1);
    expect(length("\r\n")).toBe(1);
    expect(length("  a b  ")).toBe(7);
  });

  it("is 0 for empty text and by default", () => {
    expect(length("")).toBe(0);
    expect(createPatchHarness(textLengthPatch).step().outputs.length).toBe(0);
  });

  it("counts values coerced to text", () => {
    expect(length(3.5)).toBe(3);
    expect(length(true)).toBe(4);
    expect(length(1 / 3)).toBe(8);
  });

  it("gives a loop of lengths for a loop of texts", () => {
    expect(length(loopOf(["Home", "Search", "👋🏽"]))).toEqual(loopOf([4, 6, 1]));
    expect(runPatch(textLengthPatch, [{ text: { loop: [] } }]).frames[0]!.outputs.length).toEqual(loopOf([]));
  });

  it("follows changes and keeps its memo per loop index", () => {
    const h = createPatchHarness(textLengthPatch, { inputs: { text: loopOf(["ab", "abc"]) } });
    h.step();
    expect(h.step({ inputs: { text: loopOf(["ab", "abcd"]) } }).outputs.length).toEqual(loopOf([2, 4]));
    expect(h.state(1)).toEqual({ text: "abcd", length: 4 });
    expect(h.logs).toEqual([]);
  });
});
