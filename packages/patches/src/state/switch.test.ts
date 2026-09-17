import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { switchPatch } from "./switch.ts";

describe("switch", () => {
  it("starts off, flips on pulses, and counts back-to-back pulses", () => {
    const h = createPatchHarness(switchPatch);
    expect(h.step().outputs.on).toBe(false);
    expect(h.step({ pulses: ["flip"] }).outputs.on).toBe(true);
    expect(h.step().outputs.on).toBe(true);
    expect(h.step({ pulses: ["flip"] }).outputs.on).toBe(false);
    expect(h.step({ pulses: ["flip"] }).outputs.on).toBe(true);
  });

  it("applies a pulse on frame 0 that same frame", () => {
    expect(createPatchHarness(switchPatch).step({ pulses: ["turnOn"] }).outputs.on).toBe(true);
  });

  it("turns on and off directly, doing nothing when already there", () => {
    const h = createPatchHarness(switchPatch);
    expect(h.step({ pulses: ["turnOff"] }).outputs.on).toBe(false);
    expect(h.step({ pulses: ["turnOn"] }).outputs.on).toBe(true);
    expect(h.step({ pulses: ["turnOn"] }).outputs.on).toBe(true);
    expect(h.step({ pulses: ["turnOff"] }).outputs.on).toBe(false);
  });

  it("resolves same-frame pulses as turn off > turn on > flip", () => {
    const h = createPatchHarness(switchPatch);
    expect(h.step({ pulses: ["flip", "turnOn", "turnOff"] }).outputs.on).toBe(false);
    expect(h.step({ pulses: ["flip", "turnOn"] }).outputs.on).toBe(true);
    expect(h.step({ pulses: ["flip", "turnOn"] }).outputs.on).toBe(true);
    expect(h.step({ pulses: ["flip", "turnOff"] }).outputs.on).toBe(false);
  });

  it("flips once per rising edge of a held state", () => {
    const h = createPatchHarness(switchPatch);
    expect(h.step({ inputs: { flip: true } }).outputs.on).toBe(true);
    expect(h.run(3).outputs.on).toBe(true);
    h.step({ inputs: { flip: false } });
    expect(h.step({ inputs: { flip: 1 } }).outputs.on).toBe(false);
  });

  it("keeps state per loop index and broadcasts scalar pulses", () => {
    const h = createPatchHarness(switchPatch, { inputs: { flip: loopOf([true, false, true]) } });
    expect(h.step().outputs.on).toEqual(loopOf([true, false, true]));
    expect(h.step({ inputs: { flip: loopOf([false, false, false, false]) } }).outputs.on).toEqual(loopOf([true, false, true, false]));
    expect(h.step({ pulses: ["turnOff"] }).outputs.on).toEqual(loopOf([false, false, false, false]));
    expect(h.step({ pulses: ["flip"] }).outputs.on).toEqual(loopOf([true, true, true, true]));
  });

  it("resets to off on restart", () => {
    const h = createPatchHarness(switchPatch);
    h.step({ pulses: ["turnOn"] });
    h.restart();
    expect(h.step().outputs.on).toBe(false);
  });

  it("outputs false while muted", () => {
    const result = runPatch(switchPatch, [{ turnOn: true }, {}], { muted: true });
    expect(result.frames.map((f) => f.outputs.on)).toEqual([false, false]);
  });
});
