/** Loops on cables: tagged arrays that make a patch evaluate once per item (ARCHITECTURE.md §4). */

import type { Value } from "@sonobe/core";
import type { Loop } from "../types.ts";

/** Loops are capped at this many items; longer loops are truncated with a `loop_limit` issue. */
export const MAX_LOOP_LENGTH = 10_000;

/** Wrap items as a Loop. */
export function makeLoop<T = Value>(items: readonly T[]): Loop<T> {
  return { __loop: true, items };
}

/** True for a Loop value. */
export function isLoop(value: unknown): value is Loop {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __loop?: unknown }).__loop === true &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

/** The items of a loop, or a plain value as a one-item array. */
export function loopItems(value: unknown): readonly Value[] {
  return isLoop(value) ? value.items : [value];
}

/** Number of items: the loop length, or 1 for a plain value. */
export function loopLength(value: unknown): number {
  return isLoop(value) ? value.items.length : 1;
}

/**
 * Item `index` of a value: loops wrap (index mod length) and plain values broadcast.
 * Undefined for an empty loop.
 */
export function loopItemAt(value: unknown, index: number): Value {
  if (!isLoop(value)) return value;
  const n = value.items.length;
  return n === 0 ? undefined : value.items[index % n];
}

/** A value as a Loop: Loops pass through, arrays become items, anything else a one-item loop. */
export function toLoop(value: unknown): Loop {
  if (isLoop(value)) return value;
  if (Array.isArray(value)) return makeLoop(value as Value[]);
  return makeLoop([value]);
}
