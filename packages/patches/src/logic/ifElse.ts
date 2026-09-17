/**
 * If / Else: outputs If True while Condition is on and If False otherwise. Muted, it passes If
 * True through (the variant input), so a boolean variant never passes Condition instead.
 */

import { definePatch, toBool } from "../infra/index.ts";

export const ifElse = definePatch("ifElse", {
  evaluate(ctx) {
    if (ctx.muted) {
      ctx.output("output", ctx.input("ifTrue"));
      return;
    }
    ctx.output("output", toBool(ctx.input("condition")) ? ctx.input("ifTrue") : ctx.input("ifFalse"));
  },
  mutedBehavior: "evaluate",
});
