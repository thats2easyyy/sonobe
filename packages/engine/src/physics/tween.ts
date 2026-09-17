/**
 * Duration-based tweens for Classic Animation and Cubic Bezier Animation. A retarget
 * restarts from the current value over the full duration (docs/research/gap-fill.md R11).
 */

import type { EasingFunction } from "./curves.ts";

/** Component-wise tween state (a number is a 1-component vector). */
export interface TweenState {
  from: number[];
  to: number[];
  value: number[];
  /** Seconds since the current tween started. */
  elapsed: number;
  active: boolean;
}

/** A tween at rest at `value`. */
export function createTweenState(value: readonly number[]): TweenState {
  return { from: [...value], to: [...value], value: [...value], elapsed: 0, active: false };
}

/**
 * Start a new tween from the current value toward `target` unless `target` is already the
 * destination. Returns true when a new tween started.
 */
export function retargetTween(state: TweenState, target: readonly number[]): boolean {
  let same = target.length === state.to.length;
  for (let i = 0; same && i < target.length; i++) if (target[i] !== state.to[i]) same = false;
  if (same) return false;
  const n = target.length;
  const from = new Array<number>(n);
  for (let i = 0; i < n; i++) from[i] = state.value[i] ?? target[i]!;
  state.from = from;
  state.to = [...target];
  state.value = [...from];
  state.elapsed = 0;
  state.active = true;
  return true;
}

/** Jump to `value` with no animation. */
export function jumpTween(state: TweenState, value: readonly number[]): void {
  state.from = [...value];
  state.to = [...value];
  state.value = [...value];
  state.elapsed = 0;
  state.active = false;
}

/** Advance by `dt` seconds. Returns true once the tween has reached its target. */
export function stepTween(
  state: TweenState,
  dt: number,
  duration: number,
  easing: EasingFunction,
): boolean {
  if (!state.active) return true;
  if (dt > 0) state.elapsed += dt;
  if (!(duration > 0) || state.elapsed >= duration) {
    state.value = [...state.to];
    state.active = false;
    return true;
  }
  const p = easing(state.elapsed / duration);
  for (let i = 0; i < state.to.length; i++) {
    const a = state.from[i]!;
    state.value[i] = a + p * (state.to[i]! - a);
  }
  return false;
}
