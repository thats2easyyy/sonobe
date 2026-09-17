/**
 * Literal text matching for the search patches: Find, Prefix, and Suffix are never patterns.
 * Case-insensitive matching uses the `i` and `u` regex flags (Unicode simple case folding,
 * independent of the locale). Compiled regexes are cached.
 */

import { escapeRegExp } from "../infra/index.ts";

const MAX_CACHED = 256;
const cache = new Map<string, RegExp>();

/** Where the literal must sit: anywhere, at the very start, or at the very end (never before a trailing line break). */
export type Anchor = "none" | "start" | "end";

/** A cached RegExp matching `text` literally, with `flags` and `anchor`. */
export function literalPattern(text: string, flags: string, anchor: Anchor = "none"): RegExp {
  const key = `${anchor}|${flags}|${text}`;
  let pattern = cache.get(key);
  if (pattern) return pattern;
  const body = escapeRegExp(text);
  pattern = new RegExp(anchor === "start" ? `^${body}` : anchor === "end" ? `${body}$` : body, flags);
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  cache.set(key, pattern);
  return pattern;
}

/** Text normalized to NFC, so composed and decomposed accents match. */
export function nfc(text: string): string {
  return text.normalize("NFC");
}
