/** Round: rounds each component to a number of decimal places: nearest (halves away from zero), down, and up. */

import { components, definePatch, finiteOr, fromComponents, normalizeZero } from "../infra/index.ts";
import { roundHalfAwayFromZero, variantResolver } from "./shared.ts";

const variantOf = variantResolver("round");

/** Largest magnitude below which doubles still hold fractions. */
const WHOLE_LIMIT = 2 ** 53;

export interface RoundedComponent {
  rounded: number;
  down: number;
  up: number;
}

/**
 * Round `x` to `places` decimals (negative places round to tens, hundreds…). Places round to an
 * integer and clamp to ±15; `toPrecision(15)` strips binary noise so 1.005 rounds to 1.01.
 */
export function roundComponent(x: number, places: number): RoundedComponent {
  if (!Number.isFinite(x)) return { rounded: 0, down: 0, up: 0 };
  if (Math.abs(x) >= WHOLE_LIMIT) return { rounded: x, down: x, up: x };
  const p = Math.min(15, Math.max(-15, roundHalfAwayFromZero(finiteOr(places, 0))));
  const k = 10 ** Math.abs(p);
  const n = Number((p >= 0 ? x * k : x / k).toPrecision(15));
  const back = (r: number) => normalizeZero(p >= 0 ? r / k : r * k);
  return { rounded: back(roundHalfAwayFromZero(n)), down: back(Math.floor(n)), up: back(Math.ceil(n)) };
}

export const round = definePatch("round", {
  evaluate(ctx) {
    const variant = variantOf(ctx.typeParam);
    const places = ctx.input<number>("places");
    const parts = components(ctx.input("value"), variant).map((x) => roundComponent(x, places));
    ctx.output("rounded", fromComponents(parts.map((r) => r.rounded), variant));
    ctx.output("roundedDown", fromComponents(parts.map((r) => r.down), variant));
    ctx.output("roundedUp", fromComponents(parts.map((r) => r.up), variant));
  },
});
