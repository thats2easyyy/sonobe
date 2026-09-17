/** All: on only when every item of a loop is on. */

import { definePatch } from "../infra/index.ts";
import { evaluateReducer } from "./grouping.ts";

export const loopAllPatch = definePatch("loopAll", {
  evaluate(ctx) {
    evaluateReducer(ctx, "all", "All");
  },
});
