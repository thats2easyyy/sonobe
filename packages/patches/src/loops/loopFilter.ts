/** Loop Filter: keep, drop, or repeat each item by a count. */

import { MAX_LOOP_LENGTH, definePatch, loopOf, warnOnce } from "../infra/index.ts";
import { indices } from "./shared.ts";

export const loopFilterPatch = definePatch("loopFilter", {
  evaluate(ctx) {
    const items = ctx.inputItems("loop");
    const counts = ctx.inputItems<unknown>("include");
    const out: unknown[] = [];
    if (items.length > 0 && counts.length > 0) {
      const pairs = Math.max(items.length, counts.length);
      fill: for (let i = 0; i < pairs; i++) {
        const c = counts[i % counts.length];
        const times = typeof c === "number" && c > 0 ? Math.floor(Math.min(c, MAX_LOOP_LENGTH)) : 0;
        for (let k = 0; k < times; k++) {
          if (out.length === MAX_LOOP_LENGTH) {
            warnOnce(ctx, "cap", "Loop Filter: result capped at 10,000 items.");
            break fill;
          }
          out.push(items[i % items.length]);
        }
      }
    }
    ctx.output("output", loopOf(out));
    ctx.output("index", loopOf(indices(out.length)));
  },
});
