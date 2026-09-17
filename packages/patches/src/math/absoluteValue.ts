/** Absolute Value: each component without its sign. */

import { components, definePatch, fromComponents, normalizeZero } from "../infra/index.ts";
import { variantResolver } from "./shared.ts";

const variantOf = variantResolver("absoluteValue");

export const absoluteValue = definePatch("absoluteValue", {
  evaluate(ctx) {
    const variant = variantOf(ctx.typeParam);
    const parts = components(ctx.input("value"), variant).map((x) => normalizeZero(Math.abs(x)));
    ctx.output("output", fromComponents(parts, variant));
  },
});
