/** Value for Key: reads one entry of a JSON object by exact key. */

import { definePatch, toText, zeroValue } from "../infra/index.ts";
import { hasOwnKey, readAs, variantOf } from "./shared.ts";

export const valueForKey = definePatch("valueForKey", {
  evaluate(ctx) {
    const object = ctx.input("object");
    const key = toText(ctx.input("key"));
    const variant = variantOf(ctx, valueForKey);
    const ok = hasOwnKey(object, key);
    ctx.output("value", ok ? readAs(object[key], variant) : zeroValue(variant));
    ctx.output("found", ok);
  },
});
