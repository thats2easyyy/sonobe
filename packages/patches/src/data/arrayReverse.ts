/** Array Reverse: a copy of a JSON array in reverse order. */

import { definePatch } from "../infra/index.ts";
import { warnIndexed } from "./shared.ts";

export const arrayReverse = definePatch("arrayReverse", {
  evaluate(ctx) {
    const array = ctx.input("array");
    if (Array.isArray(array)) {
      ctx.output("output", [...array].reverse());
      return;
    }
    if (array !== null && array !== undefined) warnIndexed(ctx, "notArray", "Array isn't a JSON array, so Array Reverse outputs [].");
    ctx.output("output", []);
  },
});
