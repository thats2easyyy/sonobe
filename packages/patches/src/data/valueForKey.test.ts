import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { valueForKey } from "./valueForKey.ts";

describe("valueForKey", () => {
  it("reads an entry by exact, case-sensitive key", () => {
    const h = createPatchHarness(valueForKey, { inputs: { object: { Name: "Ada", "a.b": 2 }, key: "Name" } });
    expect(h.step().outputs).toEqual({ value: "Ada", found: true });
    expect(h.step({ inputs: { key: "name" } }).outputs).toEqual({ value: null, found: false });
    expect(h.step({ inputs: { key: "a.b" } }).outputs).toEqual({ value: 2, found: true });
  });

  it("counts only own keys", () => {
    expect(createPatchHarness(valueForKey, { inputs: { object: {}, key: "toString" } }).step().outputs.found).toBe(false);
    expect(createPatchHarness(valueForKey, { inputs: { object: JSON.parse('{"toString":"x"}'), key: "toString" } }).step().outputs).toEqual({ value: "x", found: true });
  });

  it("doesn't treat arrays or other values as objects", () => {
    expect(createPatchHarness(valueForKey, { inputs: { object: ["a"], key: "0" } }).step().outputs.found).toBe(false);
    const h = createPatchHarness(valueForKey, { typeParam: "number", inputs: { object: "text", key: "length" } });
    expect(h.step().outputs).toEqual({ value: 0, found: false });
    expect(h.logs).toEqual([]);
  });

  it("finds present null and reads it as the zero value for other types", () => {
    expect(createPatchHarness(valueForKey, { typeParam: "boolean", inputs: { object: { on: null }, key: "on" } }).step().outputs).toEqual({ value: false, found: true });
    expect(createPatchHarness(valueForKey, { typeParam: "boolean", inputs: { object: { on: "true" }, key: "on" } }).step().outputs.value).toBe(true);
  });

  it("reads the same field from every looped object", () => {
    const h = createPatchHarness(valueForKey, { typeParam: "text", inputs: { object: loopOf([{ title: "One" }, { title: "Two" }, {}]), key: "title" } });
    const f = h.step();
    expect(f.outputs.value).toEqual(loopOf(["One", "Two", ""]));
    expect(f.outputs.found).toEqual(loopOf([true, true, false]));
  });
});
