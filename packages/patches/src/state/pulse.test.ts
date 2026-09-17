import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { pulsePatch } from "./pulse.ts";

describe("pulse", () => {
  it("only records on the first frame, then fires on changes for one frame", () => {
    const h = createPatchHarness(pulsePatch, { inputs: { on: true } });
    expect(h.step().pulses.size).toBe(0);
    expect(h.step().pulses.size).toBe(0);
    expect([...h.step({ inputs: { on: false } }).pulses]).toEqual(["turnedOff"]);
    expect(h.step().pulses.size).toBe(0);
    expect([...h.step({ inputs: { on: true } }).pulses]).toEqual(["turnedOn"]);
    expect(h.step().pulses.size).toBe(0);
  });

  it("alternates events for a state that changes every frame", () => {
    const h = createPatchHarness(pulsePatch);
    h.step();
    const fired = [true, false, true, false].map((on) => [...h.step({ inputs: { on } }).pulses]);
    expect(fired).toEqual([["turnedOn"], ["turnedOff"], ["turnedOn"], ["turnedOff"]]);
  });

  it("reads numbers as on above 0", () => {
    const h = createPatchHarness(pulsePatch, { inputs: { on: 0 } });
    h.step();
    expect(h.step({ inputs: { on: 0.5 } }).pulses.has("turnedOn")).toBe(true);
    expect(h.step({ inputs: { on: -1 } }).pulses.has("turnedOff")).toBe(true);
  });

  it("keeps history per loop index and seeds new indices without firing", () => {
    const h = createPatchHarness(pulsePatch, { inputs: { on: loopOf([false, true]) } });
    expect(h.step().pulses.size).toBe(0);
    const frame = h.step({ inputs: { on: loopOf([true, true, true]) } });
    expect(frame.pulseItems.turnedOn).toEqual([true, false, false]);
    expect(frame.pulses.has("turnedOff")).toBe(false);
    expect(h.step({ inputs: { on: loopOf([true, false, false]) } }).pulseItems.turnedOff).toEqual([false, true, true]);
  });

  it("seeds again after a restart", () => {
    const h = createPatchHarness(pulsePatch, { inputs: { on: false } });
    h.step();
    h.restart();
    expect(h.step({ inputs: { on: true } }).pulses.size).toBe(0);
  });
});
