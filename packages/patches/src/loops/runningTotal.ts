/** Running Total: for each item, the total of the items before it (optionally including it). */

import { definePatch, loopOf, toBool, warnOnce } from "../infra/index.ts";

export const runningTotalPatch = definePatch("runningTotal", {
  evaluate(ctx) {
    const items = ctx.inputItems<unknown>("loop");
    const inclusive = toBool(ctx.input("includeCurrent"));
    const totals = new Array<number>(items.length);
    let acc = 0;
    for (let i = 0; i < items.length; i++) {
      const raw = items[i];
      let v = 0;
      if (typeof raw === "number" && Number.isFinite(raw)) v = raw;
      else warnOnce(ctx, "nonFinite", "Running Total: an item isn't a finite number, so it counts as 0.");
      if (inclusive) acc += v;
      if (Number.isFinite(acc)) {
        totals[i] = acc;
      } else {
        totals[i] = 0;
        warnOnce(ctx, "overflow", "Running Total: a total got too large to show, so it outputs 0.");
      }
      if (!inclusive) acc += v;
    }
    ctx.output("total", loopOf(totals));
  },
});
