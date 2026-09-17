/** Split Text: cuts text at a literal separator into a loop of parts (whole-loop Text and Parts). */

import { MAX_LOOP_LENGTH, definePatch, toBool, toText } from "../infra/index.ts";
import { graphemeSplitter, warnIfCodePointsOnly } from "./graphemes.ts";
import { nfc } from "./search.ts";

/** Per instance (the patch evaluates once per frame): whether the part cap was reported since restart. */
interface SplitTextState {
  warned: boolean;
}

/**
 * Split every text at `token` (NFC-normalized, literal, case-sensitive) and join the pieces into one
 * list; an empty token splits into graphemes. Stops after `max` parts and reports whether it did.
 */
export function splitParts(texts: readonly string[], token: string, skipEmpty: boolean, max = MAX_LOOP_LENGTH): { parts: string[]; capped: boolean } {
  const separator = nfc(token);
  const parts: string[] = [];
  for (const item of texts) {
    const text = nfc(item);
    const pieces = separator === "" ? graphemeSplitter.split(text) : text.split(separator);
    for (const piece of pieces) {
      if (skipEmpty && piece === "") continue;
      if (parts.length >= max) return { parts, capped: true };
      parts.push(piece);
    }
  }
  return { parts, capped: false };
}

export const splitTextPatch = definePatch<SplitTextState>("splitText", {
  state: () => ({ warned: false }),
  evaluate(ctx) {
    const texts = ctx.inputItems<unknown>("text").map(toText);
    if (ctx.muted) {
      ctx.output("parts", texts);
      ctx.output("count", texts.length);
      return;
    }
    const token = toText(ctx.input("token"));
    if (token === "") warnIfCodePointsOnly(ctx, "Split Text");
    const { parts, capped } = splitParts(texts, token, toBool(ctx.input("skipEmpty")));
    if (capped && !ctx.state.warned) {
      ctx.state.warned = true;
      ctx.services.log("warn", "Split Text made more than 10,000 parts; the rest were dropped.");
    }
    ctx.output("parts", parts);
    ctx.output("count", parts.length);
  },
  mutedBehavior: "evaluate",
});
