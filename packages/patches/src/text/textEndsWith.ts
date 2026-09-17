/** Text Ends With: whether text finishes with a suffix, ignoring case unless Case Sensitive is on. */

import type { RuntimePatchDefinition } from "@sonobe/engine";
import { definePatch, toBool, toText } from "../infra/index.ts";
import { literalPattern, nfc } from "./search.ts";

export const textEndsWithPatch: RuntimePatchDefinition = {
  ...definePatch("textEndsWith", {
    evaluate(ctx) {
      const text = nfc(toText(ctx.input("text")));
      const suffix = nfc(toText(ctx.input("suffix")));
      const endsWith = toBool(ctx.input("caseSensitive")) ? text.endsWith(suffix) : literalPattern(suffix, "iu", "end").test(text);
      ctx.output("endsWith", endsWith);
    },
  }),
  mutedBehavior: "zero",
};
