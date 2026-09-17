import { createEmptyDocument, createRegistry, resolveNodePorts } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { optionPickerPatch } from "./optionPicker.ts";

describe("optionPicker", () => {
  it("outputs the selected option on the same frame, clamping to the options that exist", () => {
    const h = createPatchHarness(optionPickerPatch, { inputCount: 3, inputs: { option0: 10, option1: 20, option2: 30 } });
    expect(h.step().outputs.output).toBe(10);
    expect(h.step({ inputs: { option: 2 } }).outputs.output).toBe(30);
    expect(h.step({ inputs: { option: 9 } }).outputs.output).toBe(30);
    expect(h.step({ inputs: { option: -4 } }).outputs.output).toBe(10);
    expect(h.step({ inputs: { option: 1.7 } }).outputs.output).toBe(20);
    expect(h.step({ inputs: { option: true } }).outputs.output).toBe(20);
    expect(h.step({ inputs: { option: 2, option2: 31 } }).outputs.output).toBe(31);
  });

  it("uses each variant's zero value for options nobody set", () => {
    expect(createPatchHarness(optionPickerPatch, { typeParam: "color", inputs: { option: 1 } }).step().outputs.output).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(createPatchHarness(optionPickerPatch, { typeParam: "text", inputs: { option0: "Home" } }).step().outputs.output).toBe("Home");
    expect(createPatchHarness(optionPickerPatch, { typeParam: "text", inputs: { option: 1 } }).step().outputs.output).toBe("");
  });

  it("evaluates per loop index", () => {
    const h = createPatchHarness(optionPickerPatch, { typeParam: "text", inputs: { option: loopOf([1, 0, 1]), option0: "a", option1: "b" } });
    expect(h.step().outputs.output).toEqual(loopOf(["b", "a", "b"]));
    expect(h.step({ inputs: { option1: loopOf(["x", "y"]) } }).outputs.output).toEqual(loopOf(["x", "a", "x"]));
  });

  it("declares 0-based option inputs with variant defaults through dynamicPorts", () => {
    const registry = createRegistry([optionPickerPatch]);
    const doc = createEmptyDocument();
    const color = resolveNodePorts(doc, { type: "optionPicker", typeParam: "color", inputCount: 3, inputs: {}, ui: { x: 0, y: 0 } }, registry)!;
    const option0 = color.inputs.find((p) => p.key === "option0")!;
    expect(option0.type).toBe("color");
    expect(option0.default).toBe("#00000000");
    expect(color.inputs.find((p) => p.key === "option2")?.type).toBe("color");
    const number = optionPickerPatch.dynamicPorts!({ type: "optionPicker", inputs: {}, ui: { x: 0, y: 0 } }, doc);
    expect(number.inputs.map((p) => [p.key, p.default])).toEqual([["option0", 0], ["option1", 0]]);
  });
});
