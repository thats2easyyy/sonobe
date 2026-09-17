/** Square Root: the square root of each component; negative components output 0 and warn once. */

import { components, definePatch, fromComponents, warnOnce } from "../infra/index.ts";
import { variantResolver, warnNonFinite } from "./shared.ts";

const variantOf = variantResolver("squareRoot");

export const squareRoot = definePatch("squareRoot", {
  evaluate(ctx) {
    const variant = variantOf(ctx.typeParam);
    const parts = components(ctx.input("value"), variant);
    let negative = false;
    let nonFinite = false;
    for (let c = 0; c < parts.length; c++) {
      const x = parts[c]!;
      if (!Number.isFinite(x)) {
        parts[c] = 0;
        nonFinite = true;
      } else if (x < 0) {
        parts[c] = 0;
        negative = true;
      } else {
        parts[c] = Math.sqrt(x) || 0;
      }
    }
    if (negative) warnOnce(ctx, "negative", `${ctx.id}: Value is below 0, so Square Root outputs 0 for it.`);
    if (nonFinite) warnNonFinite(ctx, "Value");
    ctx.output("output", fromComponents(parts, variant));
  },
});
