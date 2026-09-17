/** Spring Converter: Response and Damping Fraction to Mass, Tension, Friction, and the Pop-compatible Bounciness and Speed. */

import { definePatch, springConverterValues, warnOnce } from "../infra/index.ts";

export const springConverter = definePatch("springConverter", {
  evaluate(ctx) {
    const response = ctx.input<number>("response");
    if (!(response > 0)) warnOnce(ctx, "response", "Spring Converter needs a Response above 0 seconds, so it uses 0.01 s.");
    const values = springConverterValues(response, ctx.input<number>("dampingFraction"));
    ctx.output("mass", values.mass);
    ctx.output("tension", values.tension);
    ctx.output("friction", values.friction);
    ctx.output("bounciness", values.bounciness);
    ctx.output("speed", values.speed);
  },
});
