import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { jsonToText } from "./jsonToText.ts";

describe("jsonToText", () => {
  it("pretty-prints with 2-space indentation by default", () => {
    const h = createPatchHarness(jsonToText, { inputs: { json: { a: [1, 2], b: {} } } });
    expect(h.step().outputs.text).toBe('{\n  "a": [\n    1,\n    2\n  ],\n  "b": {}\n}');
  });

  it("writes compact one-line text when Pretty is off", () => {
    expect(createPatchHarness(jsonToText, { inputs: { json: { a: [1, 2], b: {} }, pretty: false } }).step().outputs.text).toBe('{"a":[1,2],"b":{}}');
  });

  it("prints top-level values as JSON literals", () => {
    expect(createPatchHarness(jsonToText, { inputs: { json: "hello" } }).step().outputs.text).toBe('"hello"');
    expect(createPatchHarness(jsonToText, { inputs: { json: 42 } }).step().outputs.text).toBe("42");
    expect(createPatchHarness(jsonToText, { inputs: { json: null } }).step().outputs.text).toBe("null");
    expect(createPatchHarness(jsonToText).step().outputs.text).toBe("null");
  });

  it("writes colors as hex text and non-finite numbers as 0", () => {
    const json = { c: { r: 1, g: 1, b: 1, a: 1 }, n: Number.NaN, list: ["é"] };
    expect(createPatchHarness(jsonToText, { inputs: { json, pretty: false } }).step().outputs.text).toBe('{"c":"#FFFFFFFF","n":0,"list":["é"]}');
  });

  it("updates when the value changes", () => {
    const h = createPatchHarness(jsonToText, { inputs: { json: [1], pretty: false } });
    expect(h.step().outputs.text).toBe("[1]");
    expect(h.step({ inputs: { json: [2] } }).outputs.text).toBe("[2]");
    expect(h.step({ inputs: { pretty: true } }).outputs.text).toBe("[\n  2\n]");
  });

  it("outputs empty text for a value that contains itself, warning once", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    const h = createPatchHarness(jsonToText, { inputs: { json: loop } });
    expect(h.step().outputs.text).toBe("");
    const other: Record<string, unknown> = { list: [] };
    (other.list as unknown[]).push(other);
    expect(h.step({ inputs: { json: other } }).outputs.text).toBe("");
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("gives a loop of texts for a loop of values", () => {
    expect(createPatchHarness(jsonToText, { inputs: { json: loopOf([1, "a"]) } }).step().outputs.text).toEqual(loopOf(["1", '"a"']));
  });
});
