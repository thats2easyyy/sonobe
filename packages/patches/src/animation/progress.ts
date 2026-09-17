/** Progress: where Value sits between Start (0) and End (1); a zero-width range acts as a step. */

import { clamp01, definePatch, warnOnce } from "../infra/index.ts";

export const progress = definePatch("progress", {
  evaluate(ctx) {
    const value = ctx.input<number>("value");
    const start = ctx.input<number>("start");
    const end = ctx.input<number>("end");
    let p = end === start ? (value >= start ? 1 : 0) : (value - start) / (end - start);
    if (ctx.input<boolean>("clampToRange")) p = clamp01(p);
    if (!Number.isFinite(value) || !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(p)) {
      warnOnce(ctx, "nonFinite", "Progress got a Value, Start, or End that isn't finite, so it outputs 0.");
      p = 0;
    }
    ctx.output("progress", p);
  },
});
