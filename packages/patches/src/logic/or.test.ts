import { buildDoc, createMockRegistry, createTestRuntime, runPatch, sequenceDefinition } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { or } from "./or.ts";

describe("or", () => {
  it("is on while any input is on", () => {
    const h = createPatchHarness(or);
    expect(h.step().outputs.output).toBe(false);
    expect(h.step({ inputs: { value2: true } }).outputs.output).toBe(true);
    expect(h.step({ inputs: { value1: 3 } }).outputs.output).toBe(true);
    expect(h.step({ inputs: { value1: "off", value2: 0 } }).outputs.output).toBe(false);
  });

  it("checks every added input", () => {
    const h = createPatchHarness(or, { inputCount: 4 });
    expect(h.step().outputs.output).toBe(false);
    expect(h.step({ inputs: { value4: true } }).outputs.output).toBe(true);
  });

  it("evaluates once per loop index", () => {
    const h = createPatchHarness(or, { inputs: { value1: loopOf([false, false, true]), value2: loopOf([true, false]) } });
    expect(h.step().outputs.output).toEqual(loopOf([true, false, true]));
    expect(runPatch(or, [{ value1: loopOf([]) }]).frames[0]!.outputs.output).toEqual(loopOf([]));
  });

  it("reads an upstream pulse as on only on the frames it fires", () => {
    const beat = sequenceDefinition("beat", "pulse", [false, true, false, true, true, false]);
    const registry = createMockRegistry([or, beat]);
    const doc = buildDoc({ patches: { tick: { type: "beat" }, any: { type: "or", inputs: { value1: { link: "tick.value" } } } } }, registry);
    const rt = createTestRuntime(doc, registry);
    const seen: unknown[] = [];
    for (let i = 0; i < 6; i++) {
      rt.step();
      seen.push(rt.getValue("any.output"));
    }
    expect(seen).toEqual([false, true, false, true, true, false]);
  });

  it("passes Value 1 through while muted", () => {
    expect(runPatch(or, [{ value1: false, value2: true }], { muted: true }).frames[0]!.outputs.output).toBe(false);
  });
});
