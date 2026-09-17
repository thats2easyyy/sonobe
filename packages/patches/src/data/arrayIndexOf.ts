/** Array Index Of: the first position of an item in a JSON array, or −1. */

import { definePatch } from "../infra/index.ts";
import { jsonEqual, portJson, variantOf } from "./shared.ts";

export const arrayIndexOf = definePatch("arrayIndexOf", {
  mutedBehavior: "evaluate",
  evaluate(ctx) {
    let index = -1;
    if (!ctx.muted) {
      const array = ctx.input("array");
      if (Array.isArray(array)) {
        const item = portJson(ctx, ctx.input("item"), variantOf(ctx, arrayIndexOf));
        for (let i = 0; i < array.length; i++) {
          if (jsonEqual(array[i], item)) {
            index = i;
            break;
          }
        }
      }
    }
    ctx.output("index", index);
    ctx.output("contains", index >= 0);
  },
});
