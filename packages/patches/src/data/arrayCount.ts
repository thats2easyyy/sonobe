/** Array Count: the number of top-level elements in a JSON array. */

import { definePatch } from "../infra/index.ts";

export const arrayCount = definePatch("arrayCount", {
  evaluate(ctx) {
    const array = ctx.input("array");
    ctx.output("count", Array.isArray(array) ? array.length : 0);
  },
});
