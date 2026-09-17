import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { textReplacePatch } from "./textReplace.ts";

const replace = (inputs: Record<string, unknown>) => createPatchHarness(textReplacePatch, { inputs }).step().outputs.output;

describe("textReplace", () => {
  it("replaces every match, left to right without overlaps", () => {
    expect(replace({ text: "Welcome back, {name}!", find: "{name}", replace: "Sam" })).toBe("Welcome back, Sam!");
    expect(replace({ text: "aaa", find: "aa", replace: "b" })).toBe("ba");
    expect(replace({ text: "555-123-4567", find: "-", replace: "" })).toBe("5551234567");
    expect(replace({ text: "a", find: "a", replace: "aa" })).toBe("aa");
  });

  it("ignores case unless Case Sensitive is on", () => {
    expect(replace({ text: "Hi hi HI", find: "hi", replace: "yo" })).toBe("yo yo yo");
    expect(replace({ text: "Hi hi HI", find: "hi", replace: "yo", caseSensitive: true })).toBe("Hi yo HI");
  });

  it("treats Find and Replace literally", () => {
    expect(replace({ text: "1+1=2", find: "+", replace: " plus " })).toBe("1 plus 1=2");
    expect(replace({ text: "a*b*c", find: "*", replace: "$&$1$$" })).toBe("a$&$1$$b$&$1$$c");
    expect(replace({ text: "price", find: "price", replace: "$'" })).toBe("$'");
  });

  it("returns Text unchanged for an empty Find, and \"\" for empty Text", () => {
    expect(replace({ text: "abc", find: "", replace: "-" })).toBe("abc");
    expect(replace({ text: "", find: "a", replace: "b" })).toBe("");
    expect(createPatchHarness(textReplacePatch).step().outputs.output).toBe("");
  });

  it("normalizes Text and Find to NFC, so Output is NFC even without a match", () => {
    expect(replace({ text: "café", find: "é", replace: "e" })).toBe("cafe");
    expect(replace({ text: "café", find: "x", replace: "y" })).toBe("café");
    expect(replace({ text: "café", find: "", replace: "y" })).toBe("café");
  });

  it("evaluates per loop index", () => {
    expect(replace({ text: loopOf(["{a} and {a}", "{a}"]), find: "{a}", replace: loopOf(["x", "y"]) })).toEqual(loopOf(["x and x", "y"]));
  });

  it("passes Text through while muted", () => {
    expect(runPatch(textReplacePatch, [{ text: "Hi {name}", find: "{name}", replace: "Sam" }], { muted: true }).frames[0]!.outputs.output).toBe("Hi {name}");
  });
});
