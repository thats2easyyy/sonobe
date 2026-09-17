import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { equalsExactly, exactlyEqual, jsonEqual } from "./equalsExactly.ts";

describe("equalsExactly", () => {
  it("compares numbers with no tolerance", () => {
    const h = createPatchHarness(equalsExactly);
    expect(h.step().outputs.output).toBe(true);
    expect(h.step({ inputs: { value1: 0, value2: -0 } }).outputs.output).toBe(true);
    expect(h.step({ inputs: { value1: 0.1 + 0.2, value2: 0.3 } }).outputs.output).toBe(false);
  });

  it("compares every added value with Value 1", () => {
    const h = createPatchHarness(equalsExactly, { inputCount: 3, inputs: { value1: 5, value2: 5, value3: 5 } });
    expect(h.step().outputs.output).toBe(true);
    expect(h.step({ inputs: { value3: 6 } }).outputs.output).toBe(false);
  });

  it("matches text exactly, case-sensitive and untrimmed", () => {
    const h = createPatchHarness(equalsExactly, { typeParam: "text", inputs: { value1: "Hi", value2: "Hi" } });
    expect(h.step().outputs.output).toBe(true);
    expect(h.step({ inputs: { value2: "hi" } }).outputs.output).toBe(false);
    expect(h.step({ inputs: { value2: "Hi " } }).outputs.output).toBe(false);
  });

  it("compares colors by their 8-bit hex code", () => {
    const h = createPatchHarness(equalsExactly, { typeParam: "color", inputs: { value1: { r: 0.99999, g: 0, b: 0, a: 1 }, value2: "#FF0000FF" } });
    expect(h.step().outputs.output).toBe(true);
    expect(h.step({ inputs: { value2: "#FE0000FF" } }).outputs.output).toBe(false);
  });

  it("compares vectors component by component", () => {
    const h = createPatchHarness(equalsExactly, { typeParam: "point", inputs: { value1: [1, 2], value2: [1, 2] } });
    expect(h.step().outputs.output).toBe(true);
    expect(h.step({ inputs: { value2: [1, 2.0000001] } }).outputs.output).toBe(false);
  });

  it("compares JSON structurally with object key order ignored", () => {
    const h = createPatchHarness(equalsExactly, { typeParam: "json", inputs: { value1: { a: 1, b: [1, 2] }, value2: { b: [1, 2], a: 1 } } });
    expect(h.step().outputs.output).toBe(true);
    expect(h.step({ inputs: { value2: { a: 1, b: [2, 1] } } }).outputs.output).toBe(false);
    expect(jsonEqual(null, null)).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: "1" })).toBe(false);
    expect(jsonEqual(1, true)).toBe(false);
    expect(jsonEqual([], {})).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(exactlyEqual("a", "a", "enum")).toBe(true);
    expect(exactlyEqual(true, false, "boolean")).toBe(false);
  });

  it("evaluates once per loop index", () => {
    const h = createPatchHarness(equalsExactly, { inputs: { value1: loopOf([0, 1, 2]), value2: 1 } });
    expect(h.step().outputs.output).toEqual(loopOf([false, true, false]));
  });

  it("outputs false while muted", () => {
    expect(runPatch(equalsExactly, [{ value1: true, value2: true }], { typeParam: "boolean", muted: true }).frames[0]!.outputs.output).toBe(false);
  });
});
