/** Reverse Progress: 1 − Progress, unclamped. */

import { definePatch, warnOnce } from "../infra/index.ts";

export const reverseProgress = definePatch("reverseProgress", {
  evaluate(ctx) {
    const p = ctx.input<number>("progress");
    if (Number.isFinite(p)) {
      ctx.output("output", 1 - p);
    } else {
      warnOnce(ctx, "progress", "Reverse Progress got a Progress that isn't finite, so it outputs 0.");
      ctx.output("output", 0);
    }
  },
});
