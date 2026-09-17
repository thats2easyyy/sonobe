/** Any: on when at least one item of a loop is on. */

import { definePatch } from "../infra/index.ts";
import { evaluateReducer } from "./grouping.ts";

export const loopAnyPatch = definePatch("loopAny", {
  evaluate(ctx) {
    evaluateReducer(ctx, "any", "Any");
  },
});
