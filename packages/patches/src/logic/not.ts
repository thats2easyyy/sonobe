/** Not: the opposite of its input. */

import { definePatch, toBool } from "../infra/index.ts";

export const not = definePatch("not", {
  evaluate(ctx) {
    ctx.output("output", !toBool(ctx.input("value")));
  },
});
