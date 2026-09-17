/** Get Keys: the top-level key names of a JSON object. */

import { definePatch, isPlainObject } from "../infra/index.ts";
import { warnIndexed } from "./shared.ts";

export const getKeys = definePatch("getKeys", {
  evaluate(ctx) {
    const object = ctx.input("object");
    if (isPlainObject(object)) {
      ctx.output("keys", Object.keys(object));
      return;
    }
    if (object !== null && object !== undefined) warnIndexed(ctx, "notObject", "Object isn't a JSON object, so Get Keys outputs [].");
    ctx.output("keys", []);
  },
});
