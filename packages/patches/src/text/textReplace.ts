/** Text Replace: replaces every literal match of Find with Replace, left to right and without overlaps. */

import { definePatch, toBool, toText } from "../infra/index.ts";
import { literalPattern, nfc } from "./search.ts";

export const textReplacePatch = definePatch("textReplace", {
  evaluate(ctx) {
    const text = nfc(toText(ctx.input("text")));
    const find = nfc(toText(ctx.input("find")));
    if (find === "") {
      ctx.output("output", text);
      return;
    }
    const replace = toText(ctx.input("replace"));
    const pattern = literalPattern(find, toBool(ctx.input("caseSensitive")) ? "gu" : "giu");
    // A function replacer keeps "$&", "$1", and "$$" in Replace literal.
    ctx.output("output", text.replace(pattern, () => replace));
  },
});
