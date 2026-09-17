/** Text Contains: whether a search term appears anywhere in text, and the grapheme index of the first match. */

import { definePatch, toBool, toText } from "../infra/index.ts";
import { graphemeSplitter, warnIfCodePointsOnly } from "./graphemes.ts";
import { literalPattern, nfc } from "./search.ts";

export const textContainsPatch = definePatch("textContains", {
  evaluate(ctx) {
    if (ctx.muted) {
      ctx.output("contains", false);
      ctx.output("index", -1);
      return;
    }
    warnIfCodePointsOnly(ctx, "Text Contains");
    const text = nfc(toText(ctx.input("text")));
    const find = nfc(toText(ctx.input("find")));
    const offset = toBool(ctx.input("caseSensitive")) ? text.indexOf(find) : text.search(literalPattern(find, "iu"));
    ctx.output("contains", offset >= 0);
    ctx.output("index", offset >= 0 ? graphemeSplitter.indexAt(text, offset) : -1);
  },
  mutedBehavior: "evaluate",
});
