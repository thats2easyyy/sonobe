import { createEmptyDocument, createRegistry, resolveNodePorts } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { optionSenderPatch } from "./optionSender.ts";

describe("optionSender", () => {
  it("sends Value to the selected output and Default to the others", () => {
    const h = createPatchHarness(optionSenderPatch, { inputCount: 3 });
    expect(h.step().outputs).toEqual({ option0: 1, option1: 0, option2: 0 });
    expect(h.step({ inputs: { option: 2, value: 5, default: -1 } }).outputs).toEqual({ option0: -1, option1: -1, option2: 5 });
    expect(h.step({ inputs: { option: 40 } }).outputs.option2).toBe(5);
    expect(h.step({ inputs: { option: -3 } }).outputs.option0).toBe(5);
    expect(h.step({ inputs: { option: 1.9 } }).outputs.option1).toBe(5);
  });

  it("starts booleans at true for the selected output and false elsewhere", () => {
    const h = createPatchHarness(optionSenderPatch, { typeParam: "boolean", inputs: { option: 1 } });
    expect(h.step().outputs).toEqual({ option0: false, option1: true });
  });

  it("outputs loops when any input loops", () => {
    const h = createPatchHarness(optionSenderPatch, { inputs: { option: loopOf([0, 1, 1]) } });
    const out = h.step().outputs;
    expect(out.option0).toEqual(loopOf([1, 0, 0]));
    expect(out.option1).toEqual(loopOf([0, 1, 1]));
  });

  it("declares 0-based variadic outputs through dynamicPorts", () => {
    const registry = createRegistry([optionSenderPatch]);
    const ports = resolveNodePorts(createEmptyDocument(), { type: "optionSender", typeParam: "color", inputCount: 3, inputs: {}, ui: { x: 0, y: 0 } }, registry)!;
    expect(ports.outputs.map((p) => [p.key, p.type])).toEqual([["option0", "color"], ["option1", "color"], ["option2", "color"]]);
  });
});
