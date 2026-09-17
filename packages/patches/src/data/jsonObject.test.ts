import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { jsonObject } from "./jsonObject.ts";

describe("jsonObject", () => {
  it("builds a one-entry object from Key and Value", () => {
    expect(createPatchHarness(jsonObject).step().outputs.object).toEqual({ key: 0 });
    const h = createPatchHarness(jsonObject, { typeParam: "text", inputs: { key: "Title", value: "Hello" } });
    expect(h.step().outputs.object).toEqual({ Title: "Hello" });
  });

  it("outputs {} for an empty key and keeps dotted keys whole", () => {
    expect(createPatchHarness(jsonObject, { inputs: { key: "" } }).step().outputs.object).toEqual({});
    expect(createPatchHarness(jsonObject, { inputs: { key: "a.b", value: 2 } }).step().outputs.object).toEqual({ "a.b": 2 });
  });

  it("stores __proto__ as an ordinary key", () => {
    const out = createPatchHarness(jsonObject, { inputs: { key: "__proto__", value: 1 } }).step().outputs.object as Record<string, unknown>;
    expect(Object.hasOwn(out, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(JSON.stringify(out)).toBe('{"__proto__":1}');
  });

  it("converts colors to text and keeps JSON null", () => {
    expect(createPatchHarness(jsonObject, { typeParam: "color", inputs: { value: "#00FF00FF" } }).step().outputs.object).toEqual({ key: "#00FF00FF" });
    expect(createPatchHarness(jsonObject, { typeParam: "json", inputs: { value: null } }).step().outputs.object).toEqual({ key: null });
  });

  it("zips looped keys and values into a loop of objects", () => {
    const h = createPatchHarness(jsonObject, { inputs: { key: loopOf(["a", "b"]), value: loopOf([1, 2, 3]) } });
    expect(h.step().outputs.object).toEqual(loopOf([{ a: 1 }, { b: 2 }, { a: 3 }]));
  });

  it("outputs {} while muted", () => {
    const run = runPatch(jsonObject, [{ key: "a", value: { x: 1 } }], { muted: true, typeParam: "json" });
    expect(run.frames[0]!.outputs.object).toEqual({});
  });
});
