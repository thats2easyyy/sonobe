/** Loop Builder: separate item inputs collected into one loop. */

import { definePatch, loopOf, warnOnce } from "../infra/index.ts";
import { indices, variantPortsFor } from "./shared.ts";

/** Largest item count (the catalog's variadic maximum). */
const MAX_ITEMS = 128;

export const loopBuilderPatch = definePatch("loopBuilder", {
  dynamicPorts: variantPortsFor("loopBuilder"),
  evaluate(ctx) {
    const n = Math.min(MAX_ITEMS, Math.max(1, ctx.inputCount));
    const items = new Array<unknown>(n);
    for (let i = 0; i < n; i++) {
      const key = `item${i}`;
      if (ctx.inputItems(key).length !== 1) {
        warnOnce(ctx, "looped", "Loop Builder: each item takes one value, so only the first item of a looped input is used.");
      }
      const value = ctx.input<unknown>(key);
      items[i] = value === undefined ? null : value;
    }
    ctx.output("loop", loopOf(items));
    ctx.output("index", loopOf(indices(n)));
  },
});
