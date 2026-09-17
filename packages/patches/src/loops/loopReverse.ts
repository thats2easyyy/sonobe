/** Loop Reverse: the same items, last first. */

import { definePatch, loopOf } from "../infra/index.ts";
import { variantPortsFor } from "./shared.ts";

export const loopReversePatch = definePatch("loopReverse", {
  dynamicPorts: variantPortsFor("loopReverse"),
  evaluate(ctx) {
    ctx.output("output", loopOf([...ctx.inputItems("loop")].reverse()));
  },
});
