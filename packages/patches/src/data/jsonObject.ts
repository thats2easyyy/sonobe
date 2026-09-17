/** JSON Object: a one-entry JSON object from a key and a value. */

import { definePatch, toText } from "../infra/index.ts";
import { defineOwn, portJson, variantOf, withMutedBehavior } from "./shared.ts";

export const jsonObject = withMutedBehavior(
  definePatch("jsonObject", {
    evaluate(ctx) {
      const object: Record<string, unknown> = {};
      if (!ctx.node.muted) {
        const key = toText(ctx.input("key"));
        if (key !== "") defineOwn(object, key, portJson(ctx, ctx.input("value"), variantOf(ctx, jsonObject)));
      }
      ctx.output("object", object);
    },
  }),
  "evaluate",
);
