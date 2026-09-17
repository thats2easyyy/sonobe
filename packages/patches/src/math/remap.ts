/**
 * Remap: maps a number from one range onto another, optionally clamped and eased. Vectors
 * interpolate per component and colors in straight RGBA, clamped to 0–1.
 */

import { components, definePatch, ease, finiteOr, fromComponents, lerpComponents } from "../infra/index.ts";
import { finiteComponents, variantResolver, warnNonFinite } from "./shared.ts";

const variantOf = variantResolver("remap");

/**
 * Eased progress of `value` through [fromStart, fromEnd]. A zero-width range is a step (1 at or past
 * the start, else 0). Outside 0–1 the curve isn't applied, so extrapolation stays continuous.
 */
export function remapProgress(value: number, fromStart: number, fromEnd: number, clampToRange: boolean, curve: string): number {
  const v = finiteOr(value, 0);
  const a = finiteOr(fromStart, 0);
  const b = finiteOr(fromEnd, 0);
  let p = a === b ? (v >= a ? 1 : 0) : (v - a) / (b - a);
  if (clampToRange) p = Math.min(Math.max(p, 0), 1);
  return p >= 0 && p <= 1 ? ease(curve, p) : p;
}

export const remap = definePatch("remap", {
  evaluate(ctx) {
    const variant = variantOf(ctx.typeParam);
    const e = remapProgress(ctx.input<number>("value"), ctx.input<number>("fromStart"), ctx.input<number>("fromEnd"), ctx.input<boolean>("clampToRange") === true, String(ctx.input("curve")));
    const out = lerpComponents(components(ctx.input("toStart"), variant), components(ctx.input("toEnd"), variant), e);
    if (finiteComponents(out)) warnNonFinite(ctx, "The output");
    ctx.output("output", fromComponents(out, variant));
  },
});
