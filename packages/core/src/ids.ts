/**
 * Readable, immutable ids (ARCHITECTURE §3.2): `^[A-Za-z_][A-Za-z0-9_]*$`, derived
 * from display names on creation and unique within a component.
 */

import type { Id } from "./types.ts";

export const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Address prefixes reserved for component published ports; never valid item ids. */
export const RESERVED_IDS: readonly string[] = ["$in", "$out"];

/**
 * Names that can't be map keys in plain objects: `out["__proto__"] = x` sets the prototype instead
 * of adding a key, so an item with this id would vanish on save. Other Object.prototype names
 * ("constructor", "toString") are fine as ids because lookups go through getOwn.
 */
export const UNSAFE_IDS: readonly string[] = ["__proto__"];

const MAX_ID_LENGTH = 48;

/** True for a syntactically valid, non-reserved id. */
export function isValidId(id: unknown): id is Id {
  return typeof id === "string" && ID_PATTERN.test(id) && !RESERVED_IDS.includes(id) && !UNSAFE_IDS.includes(id);
}

/** `map[key]` when `key` is the map's own key; never an inherited member like "constructor". */
export function getOwn<T>(map: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

/**
 * The key two names share as file names on case-insensitive file systems (macOS and Windows
 * defaults), where "card.json" and "Card.json" are one file.
 */
export function fileNameKey(name: string): string {
  return name.toLowerCase();
}

/** The name in `names` that would share a file with `name` (differing only by case), if any. */
export function fileNameCollision(names: Iterable<string>, name: string): string | undefined {
  const key = fileNameKey(name);
  for (const other of names) if (other !== name && fileNameKey(other) === key) return other;
  return undefined;
}

/** True when `name` or a name that differs from it only by case is in `names`. */
export function isFileNameTaken(names: Iterable<string>, name: string): boolean {
  const key = fileNameKey(name);
  for (const other of names) if (fileNameKey(other) === key) return true;
  return false;
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
