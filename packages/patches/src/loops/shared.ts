/**
 * Helpers shared by the loop patches: index loops, the single-value port warning, JSON snapshots,
 * the muted pass-through used by the loop mutation patches, and replay caches.
 */

import type { PatchContext } from "@sonobe/engine";
import { equalValues, isPlainObject, loopOf } from "../infra/index.ts";

/** Positions 0 … n − 1. */
export function indices(n: number): number[] {
  const out = new Array<number>(Math.max(0, n));
  for (let i = 0; i < out.length; i++) out[i] = i;
  return out;
}

/** State shared by patches that warn once per restart about looped single-value ports. */
export interface WarnedState {
  warned: boolean;
}

/**
 * Log `message` once per state (so once per restart) when a loop with more than one item drives
 * any of `keys`; those ports read item 0.
 */
export function warnIfLooped(ctx: PatchContext<WarnedState>, keys: readonly string[], message: string): void {
  if (ctx.state.warned) return;
  for (const key of keys) {
    if (ctx.inputItems(key).length > 1) {
      ctx.state.warned = true;
      ctx.services.log("warn", message);
      return;
    }
  }
}

/** A deep copy of arrays and plain objects; other values are immutable and returned as they are. */
export function snapshot<T>(value: T): T {
  if (Array.isArray(value)) return value.map(snapshot) as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = snapshot(v);
    return out as T;
  }
  return value;
}

/**
 * The muted output of the loop mutation patches (mutedBehavior "evaluate"): Loop unchanged and
 * positions 0 … count − 1. Returns true when the patch is muted and has written its outputs.
 */
export function passThroughWhenMuted(ctx: PatchContext<unknown>, indexKey: string): boolean {
  if (!ctx.muted) return false;
  const items = ctx.inputItems("loop");
  ctx.output("output", loopOf(items));
  ctx.output(indexKey, loopOf(indices(items.length)));
  return true;
}

/** Same length and structurally equal items. */
export function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !equalValues(a[i], b[i])) return false;
  return true;
}

/** The last replay result for one source loop. The cached arrays are never mutated. */
export interface ReplayCache {
  source: readonly unknown[];
  items: readonly unknown[];
}

/** `replay(source)` unless `cache` already holds the result for an equal source. */
export function cachedReplay(cache: ReplayCache | null, source: readonly unknown[], replay: (source: readonly unknown[]) => unknown[]): ReplayCache {
  if (cache && sameItems(cache.source, source)) return cache;
  return { source: [...source], items: replay(source) };
}

