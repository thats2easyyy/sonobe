/** Array Join: concatenates JSON arrays (and single values) in port order. */

import { MAX_LOOP_LENGTH, definePatch, variadicKeys } from "../infra/index.ts";
import { warnIndexed } from "./shared.ts";

/** Most elements Array Join outputs. */
export const MAX_JOINED_ELEMENTS = MAX_LOOP_LENGTH;

export const arrayJoin = definePatch("arrayJoin", {
  evaluate(ctx) {
    const out: unknown[] = [];
    let capped = false;
    for (const key of variadicKeys(arrayJoin, Math.max(2, ctx.inputCount))) {
      const a = ctx.input(key);
      if (a === null || a === undefined) continue;
      const elements: readonly unknown[] = Array.isArray(a) ? a : [a];
      for (const element of elements) {
        if (out.length >= MAX_JOINED_ELEMENTS) {
          capped = true;
          break;
        }
        out.push(element);
      }
    }
    if (capped) warnIndexed(ctx, "cap", "Array Join keeps the first 10,000 elements.");
    ctx.output("array", out);
  },
});
