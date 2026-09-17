/** Change Case: uppercase, lowercase, capitalized words, or sentence case, with locale-independent mappings. */

import { definePatch, toText } from "../infra/index.ts";

const upperFirst = (_match: string, gap: string, punctuation: string, letter: string) => gap + punctuation + letter.toUpperCase();

/** A word starts at the beginning or after whitespace; leading punctuation is skipped. */
const WORD_START = /(^|\s)(\p{P}*)(\p{L})/gu;
/** A sentence starts at the beginning, or after ".", "!", or "?" followed by whitespace. */
const SENTENCE_START = /(^\s*|[.!?]\s+)(\p{P}*)(\p{L})/gu;

/** Apply a Case option key to text; unknown keys behave as "uppercase". */
export function changeCase(text: string, kind: string): string {
  switch (kind) {
    case "lowercase":
      return text.toLowerCase();
    case "capitalize":
      return text.toLowerCase().replace(WORD_START, upperFirst);
    case "sentence":
      return text.toLowerCase().replace(SENTENCE_START, upperFirst);
    default:
      return text.toUpperCase();
  }
}

export const changeCasePatch = definePatch("changeCase", {
  evaluate(ctx) {
    ctx.output("output", changeCase(toText(ctx.input("text")), toText(ctx.input("case"))));
  },
});
