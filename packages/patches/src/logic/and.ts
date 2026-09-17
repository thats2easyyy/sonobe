/** And: true while every input is on. */

import { definePatch, toBool } from "../infra/index.ts";
import { logicInputCount } from "./shared.ts";

export const and = definePatch("and", {
  evaluate(ctx) {
    const n = logicInputCount(ctx.inputCount);
    let on = true;
    for (let i = 1; i <= n; i++) {
      if (!toBool(ctx.input(`value${i}`))) {
        on = false;
        break;
      }
    }
    ctx.output("output", on);
  },
});
