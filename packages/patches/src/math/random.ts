/**
 * Random: a seeded random number between Start and End. Each loop index draws once on its first
 * evaluation and again on every Randomize pulse; the held draw rescales when the range changes.
 */

import { definePatch } from "../infra/index.ts";

export interface RandomState {
  /** Unit draw in [0, 1), or null before the first evaluation. */
  u: number | null;
  warned: boolean;
}

/**
 * Scale a unit draw into the range. Decimals cover [start, end); whole numbers are inclusive at
 * both ends, and a range with no whole number gives the whole number nearest its middle.
 */
export function randomValue(u: number, start: number, end: number, wholeNumbers: boolean): number {
  if (!wholeNumbers) return start + u * (end - start);
  const lo = Math.ceil(Math.min(start, end));
  const hi = Math.floor(Math.max(start, end));
  return hi < lo ? Math.round((start + end) / 2) : lo + Math.floor(u * (hi - lo + 1));
}

export const random = definePatch<RandomState>("random", {
  state: () => ({ u: null, warned: false }),
  evaluate(ctx) {
    if (ctx.state.u === null || ctx.pulsed("randomize")) ctx.state.u = ctx.services.random();
    let v = randomValue(ctx.state.u, ctx.input<number>("start"), ctx.input<number>("end"), ctx.input<boolean>("wholeNumbers") === true);
    if (!Number.isFinite(v)) {
      v = 0;
      if (!ctx.state.warned) {
        ctx.state.warned = true;
        ctx.services.log("warn", `${ctx.id}: Start or End isn't a finite number, so Random outputs 0`);
      }
    }
    if (v === 0) v = 0;
    ctx.output("value", v);
  },
});
