/** Loop Count: how many items a loop holds. */

import { definePatch } from "../infra/index.ts";

export const loopCountPatch = definePatch("loopCount", {
  evaluate(ctx) {
    ctx.output("count", ctx.inputItems("loop").length);
  },
});
