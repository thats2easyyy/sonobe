/** Loop: a loop of indices 0 … Count − 1. */

import { MAX_LOOP_LENGTH, definePatch, loopOf, toNumber, warnOnce } from "../infra/index.ts";
import { indices } from "./shared.ts";

export const loopPatch = definePatch("loop", {
  evaluate(ctx) {
    if (ctx.inputItems("count").length !== 1) {
      warnOnce(ctx, "looped", "Loop: Count takes one number, so only the first item of the loop is used.");
    }
    const input = ctx.input<unknown>("count");
    const raw = typeof input === "number" ? input : toNumber(input);
    if (Number.isNaN(raw)) warnOnce(ctx, "nan", "Loop: Count isn't a number, so the loop is empty.");
    if (raw > MAX_LOOP_LENGTH) warnOnce(ctx, "cap", "Loop: Count is capped at 10,000 items.");
    const n = Number.isNaN(raw) ? 0 : Math.min(MAX_LOOP_LENGTH, Math.max(0, Math.floor(raw)));
    ctx.output("index", loopOf(indices(n)));
  },
});
