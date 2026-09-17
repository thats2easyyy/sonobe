import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { textEndsWithPatch } from "./textEndsWith.ts";
import { textStartsWithPatch } from "./textStartsWith.ts";

const startsWith = (inputs: Record<string, unknown>) => createPatchHarness(textStartsWithPatch, { inputs }).step().outputs.startsWith;
const endsWith = (inputs: Record<string, unknown>) => createPatchHarness(textEndsWithPatch, { inputs }).step().outputs.endsWith;

describe("textStartsWith", () => {
  it("ignores case unless Case Sensitive is on", () => {
    expect(startsWith({ text: "Hello", prefix: "he" })).toBe(true);
    expect(startsWith({ text: "Hello", prefix: "he", caseSensitive: true })).toBe(false);
    expect(startsWith({ text: "Hello", prefix: "He", caseSensitive: true })).toBe(true);
    expect(startsWith({ text: "École", prefix: "é" })).toBe(true);
    expect(startsWith({ text: "SSx", prefix: "ß" })).toBe(false);
  });

  it("checks the very first characters without trimming", () => {
    expect(startsWith({ text: " hello", prefix: "hello" })).toBe(false);
    expect(startsWith({ text: "hi", prefix: "hi there" })).toBe(false);
    expect(startsWith({ text: "https://example.com", prefix: "https://" })).toBe(true);
    expect(startsWith({ text: "/help me", prefix: "/" })).toBe(true);
  });

  it("matches Prefix literally", () => {
    expect(startsWith({ text: "$5.00", prefix: "$5." })).toBe(true);
    expect(startsWith({ text: "$5x00", prefix: "$5." })).toBe(false);
    expect(startsWith({ text: "(a)[b]", prefix: "(a)[" })).toBe(true);
    expect(startsWith({ text: "a|b", prefix: "a|" })).toBe(true);
  });

  it("matches an empty prefix, even on empty text", () => {
    expect(startsWith({ text: "anything", prefix: "" })).toBe(true);
    expect(createPatchHarness(textStartsWithPatch).step().outputs.startsWith).toBe(true);
  });

  it("normalizes both inputs to NFC", () => {
    expect(startsWith({ text: "école", prefix: "é", caseSensitive: true })).toBe(true);
    expect(startsWith({ text: "école", prefix: "É" })).toBe(true);
  });

  it("evaluates per loop index", () => {
    expect(startsWith({ text: loopOf(["Maya", "Omar", "Marisol"]), prefix: "ma" })).toEqual(loopOf([true, false, true]));
    expect(startsWith({ text: "Maya", prefix: loopOf(["M", "m"]), caseSensitive: loopOf([true]) })).toEqual(loopOf([true, false]));
  });

  it("outputs false while muted", () => {
    expect(runPatch(textStartsWithPatch, [{ text: "abc", prefix: "a", caseSensitive: true }], { muted: true }).frames[0]!.outputs.startsWith).toBe(false);
  });
});

describe("textEndsWith", () => {
  it("ignores case unless Case Sensitive is on", () => {
    expect(endsWith({ text: "clip.MP4", suffix: ".mp4" })).toBe(true);
    expect(endsWith({ text: "clip.MP4", suffix: ".mp4", caseSensitive: true })).toBe(false);
    expect(endsWith({ text: "photo.jpeg", suffix: ".jpg" })).toBe(false);
  });

  it("anchors at the very end, never before a trailing line break", () => {
    expect(endsWith({ text: "hi\n", suffix: "hi" })).toBe(false);
    expect(endsWith({ text: "hello ", suffix: "hello" })).toBe(false);
    expect(endsWith({ text: "ok?", suffix: "?" })).toBe(true);
    expect(endsWith({ text: "a\nb", suffix: "a" })).toBe(false);
  });

  it("handles empty and long suffixes and literal characters", () => {
    expect(endsWith({ text: "", suffix: "" })).toBe(true);
    expect(endsWith({ text: "x", suffix: "" })).toBe(true);
    expect(endsWith({ text: "hi", suffix: "oh hi" })).toBe(false);
    expect(endsWith({ text: "price: 5$", suffix: "5$" })).toBe(true);
    expect(endsWith({ text: "a.b", suffix: "*b" })).toBe(false);
  });

  it("normalizes both inputs to NFC and evaluates per loop index", () => {
    expect(endsWith({ text: "café", suffix: "é", caseSensitive: true })).toBe(true);
    expect(endsWith({ text: loopOf(["a.png", "b.mov"]), suffix: ".png" })).toEqual(loopOf([true, false]));
  });

  it("outputs false while muted", () => {
    expect(runPatch(textEndsWithPatch, [{ text: "abc", suffix: "c", caseSensitive: true }], { muted: true }).frames[0]!.outputs.endsWith).toBe(false);
  });
});
