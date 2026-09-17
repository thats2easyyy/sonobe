/** Or: true while any input is on. */

import { definePatch, toBool } from "../infra/index.ts";
import { logicInputCount } from "./shared.ts";

export const or = definePatch("or", {
  evaluate(ctx) {
    const n = logicInputCount(ctx.inputCount);
    let on = false;
    for (let i = 1; i <= n; i++) {
      if (toBool(ctx.input(`value${i}`))) {
        on = true;
        break;
      }
    }
    ctx.output("output", on);
  },
});
