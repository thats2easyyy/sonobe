import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { textContainsPatch } from "./textContains.ts";

const contains = (inputs: Record<string, unknown>) => {
  const { outputs } = createPatchHarness(textContainsPatch, { inputs }).step();
  return [outputs.contains, outputs.index];
};

describe("textContains", () => {
  it("finds the first match anywhere and reports where it begins", () => {
    expect(contains({ text: "Hello world", find: "world" })).toEqual([true, 6]);
    expect(contains({ text: "Hello world", find: "O" })).toEqual([true, 4]);
    expect(contains({ text: "Hello world", find: "O", caseSensitive: true })).toEqual([false, -1]);
    expect(contains({ text: "Maya", find: "ma" })).toEqual([true, 0]);
    expect(contains({ text: "banana", find: "an" })).toEqual([true, 1]);
  });

  it("counts Index in graphemes", () => {
    expect(contains({ text: "👋🏽 hi", find: "hi" })).toEqual([true, 2]);
    expect(contains({ text: "🇯🇵🇫🇷", find: "🇫🇷" })).toEqual([true, 1]);
    expect(contains({ text: "🇯🇵x", find: "\u{1F1F5}", caseSensitive: true })).toEqual([true, 0]);
  });

  it("matches an empty Find at 0 and rejects longer Find", () => {
    expect(contains({ text: "", find: "" })).toEqual([true, 0]);
    expect(contains({ text: "abc", find: "" })).toEqual([true, 0]);
    expect(contains({ text: "hi", find: "high" })).toEqual([false, -1]);
    expect(createPatchHarness(textContainsPatch).step().outputs.contains).toBe(true);
  });

  it("matches literally with Unicode case folding and NFC", () => {
    expect(contains({ text: "1+1=2", find: "+1" })).toEqual([true, 1]);
    expect(contains({ text: "a.c", find: "." })).toEqual([true, 1]);
    expect(contains({ text: "cafe", find: "café" })).toEqual([false, -1]);
    expect(contains({ text: "CAFÉ au lait", find: "café" })).toEqual([true, 0]);
  });

  it("evaluates per loop index", () => {
    const h = createPatchHarness(textContainsPatch, { inputs: { text: loopOf(["Maya Chen", "Omar Haddad", "Theo Park"]), find: "mar" } });
    const frame = h.step();
    expect(frame.outputs.contains).toEqual(loopOf([false, true, false]));
    expect(frame.outputs.index).toEqual(loopOf([-1, 1, -1]));
  });

  it("outputs false and −1 while muted", () => {
    const result = runPatch(textContainsPatch, [{ text: "abc", find: "b" }], { muted: true });
    expect(result.frames[0]!.outputs).toEqual({ contains: false, index: -1 });
  });
});
