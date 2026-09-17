/**
 * Loop helpers (ARCHITECTURE.md §4): building and reading `Loop` values, broadcasting with
 * wrap-around, and the 10,000-item cap.
 */

import { isDecodedLoop } from "@sonobe/core";
import type { Loop } from "@sonobe/engine";

/** Largest loop the runtime keeps; longer loops are truncated with a diagnostic. */
export const MAX_LOOP_LENGTH = 10_000;

export function isLoop(value: unknown): value is Loop {
  return typeof value === "object" && value !== null && (value as { __loop?: unknown }).__loop === true && Array.isArray((value as { items?: unknown }).items);
}

/** Emit `items` as a Loop value (items are not copied). */
export function loopOf<T>(items: readonly T[]): Loop<T> {
  return { __loop: true, items };
}

/** A Loop from a Loop, a core DecodedLoop (`{ loop: true, items }`), or undefined for anything else. */
export function toLoop(value: unknown): Loop | undefined {
  if (isLoop(value)) return value;
  if (isDecodedLoop(value)) return loopOf(value.items);
  return undefined;
}

/** The items of a loop (or DecodedLoop); a scalar reads as a one-item array. */
export function loopItems<T = unknown>(value: unknown): readonly T[] {
  const loop = toLoop(value);
  return loop ? (loop.items as readonly T[]) : [value as T];
}

/**
 * Evaluation count for a set of inputs: undefined when none is a loop, 0 when any loop is empty,
 * otherwise the longest loop (shorter loops wrap, scalars broadcast).
 */
export function loopLength(values: Iterable<unknown>): number | undefined {
  let length: number | undefined;
  let empty = false;
  for (const value of values) {
    const loop = toLoop(value);
    if (!loop) continue;
    if (loop.items.length === 0) empty = true;
    length = Math.max(length ?? 0, loop.items.length);
  }
  return empty ? 0 : length;
}

/** `index` wrapped into [0, length); 0 for empty lengths. */
export function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  const r = index % length;
  return r < 0 ? r + length : r;
}

/** Item `index` of a loop with wrap-around; scalars broadcast; undefined for an empty loop. */
export function itemAt<T = unknown>(value: unknown, index: number): T | undefined {
  const loop = toLoop(value);
  if (!loop) return value as T;
  return loop.items.length ? (loop.items[wrapIndex(index, loop.items.length)] as T) : undefined;
}

/**
 * Apply `fn` per loop index over broadcast inputs. With no loop inputs it runs once and returns
 * the scalar result; otherwise it returns a Loop of results.
 */
export function mapLoops<R>(values: readonly unknown[], fn: (items: unknown[], index: number) => R): R | Loop<R> {
  const length = loopLength(values);
  if (length === undefined) return fn([...values], 0);
  const out: R[] = new Array(length);
  for (let i = 0; i < length; i++) out[i] = fn(values.map((v) => itemAt(v, i)), i);
  return loopOf(out);
}

/** Truncate to `max` items, reporting whether anything was dropped. */
export function capLoop<T>(items: readonly T[], max = MAX_LOOP_LENGTH): { items: readonly T[]; capped: boolean } {
  return items.length > max ? { items: items.slice(0, max), capped: true } : { items, capped: false };
}
