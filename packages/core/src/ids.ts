/**
 * Readable, immutable ids (ARCHITECTURE §3.2): `^[A-Za-z_][A-Za-z0-9_]*$`, derived
 * from display names on creation and unique within a component.
 */

import type { Id } from "./types.ts";

export const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Address prefixes reserved for component published ports; never valid item ids. */
export const RESERVED_IDS: readonly string[] = ["$in", "$out"];

const MAX_ID_LENGTH = 48;

/** True for a syntactically valid, non-reserved id. */
export function isValidId(id: unknown): id is Id {
  return typeof id === "string" && ID_PATTERN.test(id) && !RESERVED_IDS.includes(id);
}

function lowerWord(word: string): string {
  if (/^[A-Z0-9]+$/.test(word) || /^[A-Z][a-z0-9]*$/.test(word)) return word.toLowerCase();
  return word[0]!.toLowerCase() + word.slice(1);
}

/**
 * Derive an id from a display name: "Card" → "card", "Tap Card" → "tap_card",
 * "popAnimation" → "popAnimation", "Café Menü" → "cafe_menu", "3D Card" → "item_3d_card".
 */
export function slugify(name: string, fallback = "item"): Id {
  const ascii = name.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const words = ascii.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return fallback;
  let slug = words.map(lowerWord).join("_");
  if (/^[0-9]/.test(slug)) slug = `${fallback}_${slug}`;
  if (slug.length > MAX_ID_LENGTH) slug = slug.slice(0, MAX_ID_LENGTH).replace(/_+$/, "");
  return slug;
}

export type TakenIds = ReadonlySet<string> | Iterable<string> | ((id: string) => boolean);

function toPredicate(taken: TakenIds): (id: string) => boolean {
  if (typeof taken === "function") return taken;
  const set = taken instanceof Set ? (taken as ReadonlySet<string>) : new Set(taken);
  return (id) => set.has(id);
}

/** `base` if free, otherwise `base_2`, `base_3`, … (continuing from an existing numeric suffix). */
export function uniqueId(base: Id, taken: TakenIds): Id {
  const isTaken = toPredicate(taken);
  if (!isTaken(base)) return base;
  const match = /^(.*[^\d_])_(\d+)$/.exec(base);
  const stem = match ? match[1]! : base;
  let n = match ? Number(match[2]) + 1 : 2;
  while (isTaken(`${stem}_${n}`)) n++;
  return `${stem}_${n}`;
}

/** True for a batch temp reference like "$card" (but not "$in" / "$out"). */
export function isRefToken(value: string): boolean {
  return value.length > 1 && value.startsWith("$") && ID_PATTERN.test(value.slice(1)) && !RESERVED_IDS.includes(value);
}
