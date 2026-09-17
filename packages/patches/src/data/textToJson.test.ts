import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { TEXT_TO_JSON_ERROR_PREFIX, textToJson } from "./textToJson.ts";

describe("textToJson", () => {
  it("parses JSON text on the same frame", () => {
    expect(createPatchHarness(textToJson, { inputs: { text: '{"a": [1, true]}' } }).step().outputs).toEqual({ json: { a: [1, true] }, error: false, errorMessage: "" });
  });

  it("accepts top-level scalars, surrounding whitespace, and a byte-order mark", () => {
    expect(createPatchHarness(textToJson, { inputs: { text: " 42 " } }).step().outputs.json).toBe(42);
    expect(createPatchHarness(textToJson, { inputs: { text: '﻿"hi"' } }).step().outputs.json).toBe("hi");
    expect(createPatchHarness(textToJson, { inputs: { text: "null" } }).step().outputs).toEqual({ json: null, error: false, errorMessage: "" });
  });

  it("gives null without an error for empty text", () => {
    expect(createPatchHarness(textToJson).step().outputs).toEqual({ json: null, error: false, errorMessage: "" });
    expect(createPatchHarness(textToJson, { inputs: { text: " \n " } }).step().outputs.error).toBe(false);
  });

  it("reports invalid text and drops the last valid value at once", () => {
    const h = createPatchHarness(textToJson, { inputs: { text: "[1]" } });
    expect(h.step().outputs.json).toEqual([1]);
    for (const text of ["{a:1}", "[1,]", "NaN", "// c\n1", "1\n2"]) {
      const f = h.step({ inputs: { text } });
      expect(f.outputs.json, text).toBeNull();
      expect(f.outputs.error, text).toBe(true);
      expect(String(f.outputs.errorMessage).startsWith(TEXT_TO_JSON_ERROR_PREFIX), text).toBe(true);
    }
    expect(h.logs).toEqual([]);
  });

  it("parses per loop index", () => {
    const f = createPatchHarness(textToJson, { inputs: { text: loopOf(["1", "{"]) } }).step();
    expect(f.outputs.json).toEqual(loopOf([1, null]));
    expect(f.outputs.error).toEqual(loopOf([false, true]));
  });

  it("outputs null, false, and empty text while muted", () => {
    const run = runPatch(textToJson, [{ text: "{" }], { muted: true });
    expect(run.frames[0]!.outputs).toEqual({ json: null, error: false, errorMessage: "" });
  });
});
