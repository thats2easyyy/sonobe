/** Object Join: merges JSON objects shallowly; later inputs win. */

import { definePatch, isPlainObject, variadicIndex, variadicKeys } from "../infra/index.ts";
import { defineOwn, warnIndexed } from "./shared.ts";

export const objectJoin = definePatch("objectJoin", {
  evaluate(ctx) {
    const out: Record<string, unknown> = {};
    for (const key of variadicKeys(objectJoin, Math.max(2, ctx.inputCount))) {
      const o = ctx.input(key);
      if (isPlainObject(o)) {
        for (const k of Object.keys(o)) defineOwn(out, k, o[k]);
      } else if (o !== null && o !== undefined) {
        const n = variadicIndex(objectJoin, key);
        warnIndexed(ctx, key, `Object ${n} isn't a JSON object and was skipped.`);
      }
    }
    ctx.output("object", out);
  },
});
