/**
 * Counter: a whole-number count stepped by pulses. Jump beats Increase − Decrease; a positive Maximum Count
 * wraps the stored count into [0, max − 1], and out-of-range jumps go to 0.
 */

import { definePatch, normalizeZero, positiveMod, toNumber } from "../infra/index.ts";

export interface CounterState {
  count: number;
}

/** Floor with a 1e-6 epsilon (2.9999999999999996 reads as 3); non-finite reads as 0. */
function toWhole(value: unknown): number {
  return Math.floor(toNumber(value) + 1e-6);
}

export const counterPatch = definePatch<CounterState>("counter", {
  state: () => ({ count: 0 }),
  evaluate(ctx) {
    const max = toWhole(ctx.input("maximumCount"));
    let n = ctx.state.count;
    if (ctx.pulsed("jump")) {
      const target = toWhole(ctx.input("jumpToNumber"));
      n = max > 0 && (target < 0 || target >= max) ? 0 : target;
    } else {
      n += (ctx.pulsed("increase") ? 1 : 0) - (ctx.pulsed("decrease") ? 1 : 0);
    }
    if (max > 0) n = positiveMod(n, max);
    ctx.state.count = normalizeZero(n);
    ctx.output("count", ctx.state.count);
  },
});
