/** In Range: whether a number is inside, below, or above a range. */

import { definePatch, finiteOr } from "../infra/index.ts";

export interface RangeCheck {
  inRange: boolean;
  below: boolean;
  above: boolean;
}

/**
 * Classify `value` against [min, max] (swapped when min > max) with `bounds` deciding whether each
 * edge counts as inside. Exactly one result is true; unknown bounds keys behave as includeBoth.
 */
export function checkRange(value: number, min: number, max: number, bounds: string): RangeCheck {
  const v = finiteOr(value, 0);
  let lo = finiteOr(min, 0);
  let hi = finiteOr(max, 0);
  if (lo > hi) [lo, hi] = [hi, lo];
  const known = bounds === "includeMin" || bounds === "includeMax" || bounds === "excludeBoth";
  const mode = known ? bounds : "includeBoth";
  const includeLo = mode === "includeBoth" || mode === "includeMin";
  const includeHi = mode === "includeBoth" || mode === "includeMax";
  const inside = (includeLo ? v >= lo : v > lo) && (includeHi ? v <= hi : v < hi);
  const below = !inside && (v < lo || (v === lo && !includeLo));
  return { inRange: inside, below, above: !inside && !below };
}

export const inRange = definePatch("inRange", {
  evaluate(ctx) {
    const result = checkRange(ctx.input<number>("value"), ctx.input<number>("min"), ctx.input<number>("max"), String(ctx.input("bounds")));
    ctx.output("inRange", result.inRange);
    ctx.output("below", result.below);
    ctx.output("above", result.above);
  },
});
