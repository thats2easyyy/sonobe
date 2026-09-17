import { describe, expect, it } from "vitest";
import {
  anyPulsed,
  createChangeState,
  createEdgeState,
  createIntervalState,
  detectChange,
  detectEdges,
  firstPulsed,
  safeDuration,
  stepInterval,
} from "./pulses.ts";

const ctxWith = (pulsed: string[]) => ({ pulsed: (key: string) => pulsed.includes(key) });

describe("pulses", () => {
  it("resolves same-frame precedence", () => {
    expect(firstPulsed(ctxWith(["flip", "turnOn"]), ["turnOff", "turnOn", "flip"])).toBe("turnOn");
    expect(firstPulsed(ctxWith([]), ["turnOff", "turnOn", "flip"])).toBeUndefined();
    expect(anyPulsed(ctxWith(["flip"]), ["turnOn", "flip"])).toBe(true);
  });

  it("detects edges after seeding", () => {
    const state = createEdgeState();
    expect(detectEdges(state, true)).toEqual({ rose: false, fell: false });
    expect(detectEdges(state, true)).toEqual({ rose: false, fell: false });
    expect(detectEdges(state, false)).toEqual({ rose: false, fell: true });
    expect(detectEdges(state, true)).toEqual({ rose: true, fell: false });
  });

  it("detects changes after seeding", () => {
    const state = createChangeState<number[]>();
    expect(detectChange(state, [1, 2])).toBe(false);
    expect(detectChange(state, [1, 2])).toBe(false);
    expect(detectChange(state, [1, 3])).toBe(true);
    const rounded = createChangeState<number>();
    const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
    detectChange(rounded, 1, near);
    expect(detectChange(rounded, 1.001, near)).toBe(false);
    expect(detectChange(rounded, 2, near)).toBe(true);
  });

  it("reads durations safely", () => {
    expect(safeDuration(0.5)).toEqual({ seconds: 0.5, valid: true });
    expect(safeDuration(-1)).toEqual({ seconds: 0, valid: true });
    expect(safeDuration(Number.NaN)).toEqual({ seconds: 0, valid: false });
    expect(safeDuration("1")).toEqual({ seconds: 0, valid: false });
  });
});

describe("stepInterval", () => {
  it("ticks one interval after it starts, at 60 and 120 fps", () => {
    for (const fps of [60, 120]) {
      const state = createIntervalState();
      const ticks: number[] = [];
      for (let frame = 0; frame <= fps * 2 + 10; frame++) if (stepInterval(state, { dt: 1 / fps, interval: 1, enabled: true })) ticks.push(frame);
      expect(ticks).toEqual([fps, fps * 2]);
    }
  });

  it("pauses, resets, and ticks every frame at interval 0", () => {
    const state = createIntervalState();
    const step = (enabled: boolean, reset = false) => stepInterval(state, { dt: 0.25, interval: 1, enabled, reset });
    step(true);
    step(true);
    step(true);
    step(false);
    expect(state.elapsed).toBe(0.5);
    step(true);
    expect(state.elapsed).toBe(0.5);
    expect(step(true)).toBe(false);
    expect(step(true, true)).toBe(false);
    expect(state.elapsed).toBe(0);

    const fast = createIntervalState();
    expect([0, 1, 2, 3].map(() => stepInterval(fast, { dt: 1 / 60, interval: 0, enabled: true }))).toEqual([false, true, true, true]);
  });
});
