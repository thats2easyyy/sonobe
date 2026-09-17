/** Loop Sum: the total of every item (numbers, vectors component-wise, text joined). */

import { createArithmeticReport, definePatch, foldArithmetic, warnOnce } from "../infra/index.ts";

export const loopSumPatch = definePatch("loopSum", {
  evaluate(ctx) {
    const report = createArithmeticReport();
    const sum = foldArithmetic("add", ctx.inputItems("loop"), ctx.typeParam ?? "number", report);
    if (report.nonFinite) warnOnce(ctx, "nonFinite", "Loop Sum: the total got too large to show, so it outputs 0.");
    ctx.output("sum", sum);
  },
});
