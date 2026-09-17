/** Loop to Array: packs a whole loop into one JSON array in document encoding. */

import { definePatch, toJson, warnOnce } from "../infra/index.ts";

export const loopToArrayPatch = definePatch("loopToArray", {
  evaluate(ctx) {
    let nonFinite = false;
    const flag = () => {
      nonFinite = true;
    };
    const array = ctx.inputItems("loop").map((item) => toJson(item, flag));
    if (nonFinite) warnOnce(ctx, "nonFinite", "Loop to Array: a number wasn't finite, so it was written as 0.");
    ctx.output("array", array);
  },
});
