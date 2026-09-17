import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { counterPatch } from "./counter.ts";

describe("counter", () => {
  it("starts at 0, steps on pulses, and counts back-to-back pulses", () => {
    const h = createPatchHarness(counterPatch);
    expect(h.step().outputs.count).toBe(0);
    expect(h.step({ pulses: ["increase"] }).outputs.count).toBe(1);
    expect(h.step({ pulses: ["increase"] }).outputs.count).toBe(2);
    expect(h.step({ pulses: ["increase"] }).outputs.count).toBe(3);
    expect(h.step().outputs.count).toBe(3);
    expect(h.step({ pulses: ["decrease"] }).outputs.count).toBe(2);
    expect(h.step({ pulses: ["increase", "decrease"] }).outputs.count).toBe(2);
  });

  it("applies a frame-0 pulse on frame 0 and goes negative without a maximum", () => {
    const h = createPatchHarness(counterPatch);
    expect(h.step({ pulses: ["decrease"] }).outputs.count).toBe(-1);
    expect(h.step({ pulses: ["decrease"] }).outputs.count).toBe(-2);
  });

  it("lets Jump beat Increase and Decrease", () => {
    const h = createPatchHarness(counterPatch, { inputs: { jumpToNumber: 7 } });
    expect(h.step({ pulses: ["jump", "increase", "decrease"] }).outputs.count).toBe(7);
    expect(h.step({ pulses: ["jump", "increase"] }).outputs.count).toBe(7);
    h.set({ jumpToNumber: 2 });
    expect(h.step().outputs.count).toBe(7);
  });

  it("wraps within Maximum Count and sends out-of-range jumps to 0", () => {
    const h = createPatchHarness(counterPatch, { inputs: { maximumCount: 3 } });
    const counts = [0, 1, 2, 3].map(() => h.step({ pulses: ["increase"] }).outputs.count);
    expect(counts).toEqual([1, 2, 0, 1]);
    h.step({ pulses: ["decrease"] });
    expect(h.step({ pulses: ["decrease"] }).outputs.count).toBe(2);
    expect(h.step({ inputs: { jumpToNumber: 5 }, pulses: ["jump"] }).outputs.count).toBe(0);
    expect(h.step({ inputs: { jumpToNumber: -1 }, pulses: ["jump"] }).outputs.count).toBe(0);
    expect(h.step({ inputs: { jumpToNumber: 2 }, pulses: ["jump"] }).outputs.count).toBe(2);
  });

  it("re-wraps the stored count when Maximum Count changes, without a pulse", () => {
    const h = createPatchHarness(counterPatch);
    h.step({ pulses: ["increase"] });
    h.step({ pulses: ["increase"] });
    h.step({ pulses: ["increase"] });
    expect(h.step({ pulses: ["increase"] }).outputs.count).toBe(4);
    expect(h.step({ inputs: { maximumCount: 3 } }).outputs.count).toBe(1);
    expect(h.step({ inputs: { maximumCount: 10 } }).outputs.count).toBe(1);
  });

  it("rounds fractional inputs down with an epsilon and treats non-finite inputs as 0", () => {
    const jump = (n: number, extra: Record<string, unknown> = {}) =>
      createPatchHarness(counterPatch, { inputs: { jumpToNumber: n, ...extra } }).step({ pulses: ["jump"] }).outputs.count;
    expect(jump(2.5)).toBe(2);
    expect(jump(-1.5)).toBe(-2);
    expect(jump(0.1 * 3 * 10)).toBe(3);
    expect(jump(2.9999999999999996)).toBe(3);
    expect(jump(Number.POSITIVE_INFINITY)).toBe(0);
    expect(jump(Number.NaN)).toBe(0);
    expect(jump(-5, { maximumCount: Number.NaN })).toBe(-5);
    expect(jump(2, { maximumCount: 2.9999999999999996 })).toBe(2);
    expect(jump(3, { maximumCount: 2.9999999999999996 })).toBe(0);
    expect(Object.is(jump(-0), 0)).toBe(true);
  });

  it("keeps a count per loop index and broadcasts scalar pulses", () => {
    const h = createPatchHarness(counterPatch, { inputs: { increase: loopOf([true, false]) } });
    expect(h.step().outputs.count).toEqual(loopOf([1, 0]));
    expect(h.step({ pulses: ["increase"] }).outputs.count).toEqual(loopOf([2, 1]));
    expect(h.step({ inputs: { increase: loopOf([false, false, false]) } }).outputs.count).toEqual(loopOf([2, 1, 0]));
    expect(h.step({ inputs: { maximumCount: loopOf([2, 2, 5]) }, pulses: ["increase"] }).outputs.count).toEqual(loopOf([1, 0, 1]));
  });

  it("returns to 0 on restart", () => {
    const h = createPatchHarness(counterPatch);
    h.step({ pulses: ["increase"] });
    h.restart();
    expect(h.step().outputs.count).toBe(0);
  });
});
