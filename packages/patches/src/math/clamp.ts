/** Clamp: keeps each component between Min and Max, swapping the limits when Min > Max. */

import { components, definePatch, finiteOr, fromComponents, normalizeZero } from "../infra/index.ts";
import { variantResolver } from "./shared.ts";

const variantOf = variantResolver("clamp");

/** `value` limited to [min(a, b), max(a, b)]; non-finite inputs read 0. */
export function clampBetween(value: number, a: number, b: number): number {
  const x = finiteOr(a, 0);
  const y = finiteOr(b, 0);
  return normalizeZero(Math.min(Math.max(finiteOr(value, 0), Math.min(x, y)), Math.max(x, y)));
}

export const clamp = definePatch("clamp", {
  evaluate(ctx) {
    const variant = variantOf(ctx.typeParam);
    const value = components(ctx.input("value"), variant);
    const lo = components(ctx.input("min"), variant);
    const hi = components(ctx.input("max"), variant);
    ctx.output("output", fromComponents(value.map((v, c) => clampBetween(v, lo[c] ?? 0, hi[c] ?? 0)), variant));
  },
});
