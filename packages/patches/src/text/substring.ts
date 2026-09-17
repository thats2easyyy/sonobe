/** Substring: keeps Length graphemes from Start, optionally ending with "…" when text was cut off. */

import { definePatch, toBool, toNumber, toText, whole } from "../infra/index.ts";
import { graphemeSplitter, warnIfCodePointsOnly } from "./graphemes.ts";

/** A count or position: rounded down after a 1e-6 epsilon, never below 0; non-finite counts as 0. */
const count = (value: unknown) => Math.max(0, whole(toNumber(value)));

/** The kept graphemes of `text`, with a trailing "…" (whitespace before it trimmed) when `ellipsis` and more followed. */
export function substring(text: string, start: number, length: number, ellipsis: boolean): string {
  const chars = graphemeSplitter.split(text);
  const from = count(start);
  const end = Math.min(chars.length, from + count(length));
  let output = from < chars.length ? chars.slice(from, end).join("") : "";
  if (ellipsis && output !== "" && end < chars.length) output = output.trimEnd() + "…";
  return output;
}

export const substringPatch = definePatch("substring", {
  evaluate(ctx) {
    warnIfCodePointsOnly(ctx, "Substring");
    ctx.output("output", substring(toText(ctx.input("text")), ctx.input<number>("start"), ctx.input<number>("length"), toBool(ctx.input("ellipsis"))));
  },
});
