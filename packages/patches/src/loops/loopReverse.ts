/** Loop Reverse: the same items, last first. */

import { definePatch, loopOf } from "../infra/index.ts";

export const loopReversePatch = definePatch("loopReverse", {
  evaluate(ctx) {
    ctx.output("output", loopOf([...ctx.inputItems("loop")].reverse()));
  },
});
