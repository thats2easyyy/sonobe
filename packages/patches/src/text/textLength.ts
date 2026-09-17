/** Text Length: counts user-perceived characters, so each emoji or accented letter counts as 1. */

import { definePatch, toText } from "../infra/index.ts";
import { graphemeSplitter, warnIfCodePointsOnly } from "./graphemes.ts";

/** Memo of the last text and its length, so unchanged long text isn't re-segmented every frame. */
interface TextLengthState {
  text: string | null;
  length: number;
}

export const textLengthPatch = definePatch<TextLengthState>("textLength", {
  state: () => ({ text: null, length: 0 }),
  evaluate(ctx) {
    warnIfCodePointsOnly(ctx, "Text Length");
    const text = toText(ctx.input("text"));
    if (text !== ctx.state.text) {
      ctx.state.text = text;
      ctx.state.length = graphemeSplitter.count(text);
    }
    ctx.output("length", ctx.state.length);
  },
});
