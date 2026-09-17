/** Text Starts With: whether text begins with a prefix, ignoring case unless Case Sensitive is on. */

import type { RuntimePatchDefinition } from "@sonobe/engine";
import { definePatch, toBool, toText } from "../infra/index.ts";
import { literalPattern, nfc } from "./search.ts";

export const textStartsWithPatch: RuntimePatchDefinition = {
  ...definePatch("textStartsWith", {
    evaluate(ctx) {
      const text = nfc(toText(ctx.input("text")));
      const prefix = nfc(toText(ctx.input("prefix")));
      const startsWith = toBool(ctx.input("caseSensitive")) ? text.startsWith(prefix) : literalPattern(prefix, "iu", "start").test(text);
      ctx.output("startsWith", startsWith);
    },
  }),
  mutedBehavior: "zero",
};
