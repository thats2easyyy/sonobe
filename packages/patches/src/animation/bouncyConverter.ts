/** Bouncy Converter: Pop Animation's Bounciness and Speed as physical Tension and Friction (mass 1). */

import { bouncyConverterValues, definePatch } from "../infra/index.ts";

export const bouncyConverter = definePatch("bouncyConverter", {
  evaluate(ctx) {
    const { tension, friction } = bouncyConverterValues(ctx.input<number>("bounciness"), ctx.input<number>("speed"));
    ctx.output("tension", tension);
    ctx.output("friction", friction);
  },
});
