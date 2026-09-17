/**
 * Pulse and timing helpers: same-frame precedence between pulse inputs, edge and change detection
 * that seeds on the first evaluation (gap-fill R1), safe durations, and the repeating-interval
 * metronome.
 */

import type { PatchContext } from "@sonobe/engine";
import { equalValues } from "./values.ts";

/** The first key, in precedence order, whose input pulsed this frame, e.g. `["turnOff", "turnOn", "flip"]`. */
export function firstPulsed(ctx: Pick<PatchContext, "pulsed">, keys: readonly string[]): string | undefined {
  for (const key of keys) if (ctx.pulsed(key)) return key;
  return undefined;
}

/** True when any of `keys` pulsed this frame. */
export function anyPulsed(ctx: Pick<PatchContext, "pulsed">, keys: readonly string[]): boolean {
  return firstPulsed(ctx, keys) !== undefined;
}

export interface EdgeState {
  previous: boolean;
  seeded: boolean;
}

export function createEdgeState(): EdgeState {
  return { previous: false, seeded: false };
}

/** Rising and falling edges since the last call. The first call only records, so a state that starts on doesn't fire. */
export function detectEdges(state: EdgeState, value: boolean): { rose: boolean; fell: boolean } {
  const rose = state.seeded && value && !state.previous;
  const fell = state.seeded && !value && state.previous;
  state.previous = value;
  state.seeded = true;
  return { rose, fell };
}

export interface ChangeState<T = unknown> {
  previous: T | undefined;
  seeded: boolean;
}

export function createChangeState<T = unknown>(): ChangeState<T> {
  return { previous: undefined, seeded: false };
}

/** True when `value` differs from the last call's value (structural equality by default). The first call seeds. */
export function detectChange<T>(state: ChangeState<T>, value: T, equals: (a: T, b: T) => boolean = equalValues): boolean {
  const changed = state.seeded && !equals(state.previous as T, value);
  state.previous = value;
  state.seeded = true;
  return changed;
}

/** A duration input read safely: non-finite values become 0 and are flagged invalid; negative values become 0 (instant). */
export function safeDuration(value: unknown): { seconds: number; valid: boolean } {
  if (typeof value !== "number" || !Number.isFinite(value)) return { seconds: 0, valid: false };
  return { seconds: value > 0 ? value : 0, valid: true };
}

export interface IntervalState {
  /** Seconds since the last tick. */
  elapsed: number;
  /** Whether `enabled` was on at the previous step. */
  active: boolean;
}

export function createIntervalState(): IntervalState {
  return { elapsed: 0, active: false };
}

/**
 * One frame of a repeating interval (Repeating Pulse's metronome); returns true on a tick frame.
 * `reset` restarts the countdown and suppresses that frame's tick. No time accrues on the frame
 * `enabled` turns on. At most one tick fires per frame and the remainder carries over. An interval
 * of 0 (or below one frame) ticks on every active frame after the first.
 */
export function stepInterval(state: IntervalState, options: { dt: number; interval: number; enabled: boolean; reset?: boolean }): boolean {
  const interval = Number.isFinite(options.interval) && options.interval > 0 ? options.interval : 0;
  let tick = false;
  if (options.reset) {
    state.elapsed = 0;
  } else if (options.enabled && state.active) {
    state.elapsed += options.dt > 0 ? options.dt : 0;
    const ticks = interval > 0 ? Math.floor((state.elapsed + 1e-6) / interval) : 1;
    if (ticks >= 1) {
      tick = true;
      state.elapsed = interval > 0 ? Math.max(0, state.elapsed - ticks * interval) : 0;
    }
  }
  state.active = options.enabled;
  return tick;
}
