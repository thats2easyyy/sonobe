/** Value at Index: reads one element of a JSON array by position. */

import { definePatch, toNumber, whole, zeroValue } from "../infra/index.ts";
import { readAs, variantOf } from "./shared.ts";

export const valueAtIndex = definePatch("valueAtIndex", {
  evaluate(ctx) {
    const array = ctx.input("array");
    const raw = ctx.input("index");
    const i = whole(typeof raw === "number" ? raw : toNumber(raw, Number.NaN));
    const variant = variantOf(ctx, valueAtIndex);
    const ok = Array.isArray(array) && Number.isInteger(i) && i >= 0 && i < array.length;
    ctx.output("value", ok ? readAs((array as unknown[])[i], variant) : zeroValue(variant));
    ctx.output("found", ok);
  },
});
