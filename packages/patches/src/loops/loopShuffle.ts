/** Loop Shuffle: a random order picked on each pulse and held until the next one. */

import { definePatch, loopOf } from "../infra/index.ts";
import { indices, warnIfLooped } from "./shared.ts";

export interface LoopShuffleState {
  /** null = original order; otherwise source positions in output order. */
  order: number[] | null;
  variant: string | undefined;
  warned: boolean;
}

/** Surviving stored positions below `n` in stored order, then the missing positions ascending. */
export function fitOrder(order: readonly number[] | null, n: number): number[] {
  if (order === null) return indices(n);
  const out: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  for (const p of order) {
    if (p < n) {
      out.push(p);
      used[p] = true;
    }
  }
  for (let p = 0; p < n; p++) if (!used[p]) out.push(p);
  return out;
}

/** A uniform Fisher–Yates permutation of 0 … n − 1. */
export function fisherYates(n: number, random: () => number): number[] {
  const a = indices(n);
  for (let i = n - 1; i >= 1; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

function sameOrder(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const loopShufflePatch = definePatch<LoopShuffleState>("loopShuffle", {
  state: () => ({ order: null, variant: undefined, warned: false }),
  evaluate(ctx) {
    const state = ctx.state;
    const variant = ctx.typeParam ?? "number";
    if (state.variant !== variant) {
      state.variant = variant;
      state.order = null;
    }
    warnIfLooped(ctx, ["shuffle", "reset"], "Loop Shuffle: Shuffle and Reset listen to one pulse, so only item 0 of a looped input counts. Combine looped pulses with Any first.");
    const items = ctx.inputItems("loop");
    const n = items.length;
    if (ctx.pulsed("reset")) state.order = null;
    if (ctx.pulsed("shuffle") && n >= 2) {
      const current = fitOrder(state.order, n);
      let next = current;
      for (let attempt = 0; attempt < 16 && sameOrder(next, current); attempt++) {
        next = fisherYates(n, () => ctx.services.random());
      }
      if (sameOrder(next, current)) {
        next = [...current];
        [next[0], next[1]] = [next[1]!, next[0]!];
      }
      state.order = next;
    }
    ctx.output("output", loopOf(fitOrder(state.order, n).map((p) => items[p])));
  },
});
