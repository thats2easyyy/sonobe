/** JSON Array: collects its item ports (`item0…`, counted from 0) into one JSON array. */

import { definePatch, variadicKeys } from "../infra/index.ts";
import { portJson, variantOf } from "./shared.ts";

export const jsonArray = definePatch("jsonArray", {
  mutedBehavior: "evaluate",
  evaluate(ctx) {
    if (ctx.muted) {
      ctx.output("array", []);
      return;
    }
    const variant = variantOf(ctx, jsonArray);
    const array: unknown[] = [];
    for (const key of variadicKeys(jsonArray, Math.max(1, ctx.inputCount))) array.push(portJson(ctx, ctx.input(key), variant));
    ctx.output("array", array);
  },
});
