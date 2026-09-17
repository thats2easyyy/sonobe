import { createEmptyDocument, createRegistry, resolveNodePorts } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { optionSwitchPatch } from "./optionSwitch.ts";

describe("optionSwitch", () => {
  it("starts at 0 and switches to the pulsed option", () => {
    const h = createPatchHarness(optionSwitchPatch);
    expect(h.step().outputs.option).toBe(0);
    expect(h.step({ pulses: ["setTo2"] }).outputs.option).toBe(2);
    expect(h.step({ pulses: ["setTo2"] }).outputs.option).toBe(2);
    expect(h.step().outputs.option).toBe(2);
    expect(h.step({ pulses: ["setTo0"] }).outputs.option).toBe(0);
    expect(h.step({ pulses: ["setTo1"] }).outputs.option).toBe(1);
  });

  it("applies a frame-0 pulse on frame 0 and lets the highest option win a collision", () => {
    const h = createPatchHarness(optionSwitchPatch, { inputCount: 4 });
    expect(h.step({ pulses: ["setTo3", "setTo1"] }).outputs.option).toBe(3);
    expect(h.step({ pulses: ["setTo0", "setTo2"] }).outputs.option).toBe(2);
  });

  it("switches on the rising edge of a held state", () => {
    const h = createPatchHarness(optionSwitchPatch, { inputs: { setTo1: true } });
    expect(h.step().outputs.option).toBe(1);
    expect(h.step({ pulses: ["setTo0"] }).outputs.option).toBe(0);
    expect(h.step().outputs.option).toBe(0);
  });

  it("keeps an option per loop index", () => {
    const h = createPatchHarness(optionSwitchPatch, { inputs: { setTo2: loopOf([false, true]) } });
    expect(h.step().outputs.option).toEqual(loopOf([0, 2]));
    expect(h.step({ pulses: ["setTo1"] }).outputs.option).toEqual(loopOf([1, 1]));
  });

  it("declares 0-based Set to ports through dynamicPorts", () => {
    const registry = createRegistry([optionSwitchPatch]);
    const ports = resolveNodePorts(createEmptyDocument(), { type: "optionSwitch", inputCount: 3, inputs: {}, ui: { x: 0, y: 0 } }, registry)!;
    for (const key of ["setTo0", "setTo1", "setTo2"]) expect(ports.inputs.find((p) => p.key === key)?.type, key).toBe("pulse");
    expect(optionSwitchPatch.dynamicPorts!({ type: "optionSwitch", inputCount: 2, inputs: {}, ui: { x: 0, y: 0 } }, createEmptyDocument()).inputs.map((p) => p.key)).toEqual(["setTo0", "setTo1"]);
  });
});
