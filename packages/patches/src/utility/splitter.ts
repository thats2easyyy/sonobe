/**
 * Splitter: passes Value through on the same frame. Casting happens before evaluation: the
 * engine coerces the upstream value to the patch's type with core `coerce`.
 */

import { definePatch } from "../infra/index.ts";

export const splitter = definePatch("splitter", {
  evaluate(ctx) {
    ctx.output("output", ctx.input("value"));
  },
});
