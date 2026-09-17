/** Set Value for Key: a copy of a JSON object with one key added or replaced. */

import { definePatch, isPlainObject, toText } from "../infra/index.ts";
import { defineOwn, portJson, shallowCopy, variantOf, warnIndexed } from "./shared.ts";

export const setValueForKey = definePatch("setValueForKey", {
  evaluate(ctx) {
    const object = ctx.input("object");
    const key = toText(ctx.input("key"));
    const base = isPlainObject(object) ? object : {};
    if (object !== null && object !== undefined && !isPlainObject(object)) {
      warnIndexed(ctx, "notObject", "Object isn't a JSON object, so Set Value for Key starts from {}.");
    }
    if (key === "") {
      ctx.output("output", base);
      return;
    }
    const out = shallowCopy(base);
    defineOwn(out, key, portJson(ctx, ctx.input("value"), variantOf(ctx, setValueForKey)));
    ctx.output("output", out);
  },
});
