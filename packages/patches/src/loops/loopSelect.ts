/** Loop Select: pick items by position, in any order, with repeats. */

import { definePatch, loopOf } from "../infra/index.ts";
import { indices } from "./shared.ts";

export const loopSelectPatch = definePatch("loopSelect", {
  evaluate(ctx) {
    const items = ctx.inputItems("loop");
    const picks = ctx.inputItems<unknown>("index");
    const out: unknown[] = [];
    for (const raw of picks) {
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      const i = Math.floor(raw);
      if (i < 0 || i >= items.length) continue;
      out.push(items[i]);
    }
    ctx.output("output", loopOf(out));
    ctx.output("outputIndex", loopOf(indices(out.length)));
  },
});
