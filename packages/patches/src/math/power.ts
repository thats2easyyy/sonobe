/**
 * Power: raises Value 1 to each later exponent in turn ((base^e1)^e2), component-wise. A step with
 * no real or finite value (−8 to the 1/3, 0 to a negative power) makes that component 0 and warns once.
 */

import { components, definePatch, finiteOr, fromComponents, warnOnce } from "../infra/index.ts";
import { finiteComponents, mathInputCount, variantResolver } from "./shared.ts";

const variantOf = variantResolver("power");

/** Left fold of `Math.pow` over component arrays; returns whether any step wasn't finite. */
export function foldPower(base: number[], exponents: readonly (readonly number[])[]): boolean {
  let bad = finiteComponents(base);
  for (const exponent of exponents) {
    for (let c = 0; c < base.length; c++) {
      const r = Math.pow(base[c]!, finiteOr(exponent[c], 0));
      if (Number.isFinite(r)) base[c] = r;
      else {
        base[c] = 0;
        bad = true;
      }
    }
  }
  finiteComponents(base);
  return bad;
}

export const power = definePatch("power", {
  evaluate(ctx) {
    const variant = variantOf(ctx.typeParam);
    const n = mathInputCount(ctx.inputCount);
    const acc = components(ctx.input("value1"), variant);
    const exponents: number[][] = [];
    for (let i = 2; i <= n; i++) exponents.push(components(ctx.input(`value${i}`), variant));
    if (foldPower(acc, exponents)) {
      warnOnce(ctx, "nonFinite", `${ctx.id}: the power has no real value or is too large, so that part outputs 0.`);
    }
    ctx.output("output", fromComponents(acc, variant));
  },
});
