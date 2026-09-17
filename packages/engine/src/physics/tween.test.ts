import { describe, expect, it } from "vitest";
import { EASINGS } from "./curves.ts";
import { createTweenState, jumpTween, retargetTween, stepTween } from "./tween.ts";

describe("tween (Classic Animation)", () => {
  it("animates over the duration and finishes exactly at the target", () => {
    const state = createTweenState([0]);
    expect(retargetTween(state, [100])).toBe(true);
    expect(stepTween(state, 0.25, 1, EASINGS.linear)).toBe(false);
    expect(state.value[0]).toBeCloseTo(25, 12);
    expect(stepTween(state, 0.75, 1, EASINGS.linear)).toBe(true);
    expect(state.value).toEqual([100]);
    expect(state.active).toBe(false);
  });

  it("retarget restarts from the current value over the full duration", () => {
    const state = createTweenState([0]);
    retargetTween(state, [100]);
    stepTween(state, 0.5, 1, EASINGS.linear);
    expect(state.value[0]).toBeCloseTo(50, 12);
    expect(retargetTween(state, [0])).toBe(true);
    expect(state.from).toEqual([50]);
    stepTween(state, 0.5, 1, EASINGS.linear);
    expect(state.value[0]).toBeCloseTo(25, 12);
    stepTween(state, 0.5, 1, EASINGS.linear);
    expect(state.value[0]).toBe(0);
  });

  it("the same target does not restart", () => {
    const state = createTweenState([0]);
    retargetTween(state, [10]);
    stepTween(state, 0.3, 1, EASINGS.linear);
    expect(retargetTween(state, [10])).toBe(false);
    expect(state.elapsed).toBeCloseTo(0.3, 12);
  });

  it("applies the curve component-wise", () => {
    const state = createTweenState([0, 10]);
    retargetTween(state, [100, 20]);
    stepTween(state, 0.5, 1, EASINGS.quadraticIn);
    expect(state.value[0]).toBeCloseTo(25, 12);
    expect(state.value[1]).toBeCloseTo(12.5, 12);
  });

  it("zero duration jumps; jumpTween sets without animating", () => {
    const state = createTweenState([0]);
    retargetTween(state, [5]);
    expect(stepTween(state, 0, 0, EASINGS.linear)).toBe(true);
    expect(state.value).toEqual([5]);
    jumpTween(state, [9]);
    expect(state.value).toEqual([9]);
    expect(stepTween(state, 0.1, 1, EASINGS.linear)).toBe(true);
  });

  it("dimension changes start new components at the target", () => {
    const state = createTweenState([1]);
    retargetTween(state, [3, 4]);
    expect(state.from).toEqual([1, 4]);
  });
});
