/**
 * Text and number formatting helpers: exact decimal rounding without exponent notation,
 * digit grouping, the engine's number → text coercion, and regex escaping.
 */

import { formatNumber as coreFormatNumber } from "@sonobe/core";

/** Nearest rounds half away from zero; down toward −∞; up toward +∞. */
export type RoundingMode = "nearest" | "down" | "up";

/** Number → text the way port coercion does it: up to 6 decimals, no trailing zeros, no -0. */
export function numberToText(value: number): string {
  return coreFormatNumber(value);
}

/** Digits of |x| from its shortest round-trip representation, split at the decimal point. */
function decimalParts(x: number): { negative: boolean; int: string; frac: string } {
  const s = String(x);
  const negative = s.startsWith("-");
  const body = negative ? s.slice(1) : s;
  const [mantissa = "0", exponent] = body.split("e");
  const [mi = "0", mf = ""] = mantissa.split(".");
  let digits = mi + mf;
  let point = mi.length + (exponent ? Number(exponent) : 0);
  if (point <= 0) {
    digits = "0".repeat(1 - point) + digits;
    point = 1;
  }
  if (point > digits.length) digits += "0".repeat(point - digits.length);
  return { negative, int: digits.slice(0, point).replace(/^0+(?=\d)/, ""), frac: digits.slice(point) };
}

function incrementDigits(digits: string): string {
  const chars = digits.split("");
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i] === "9") {
      chars[i] = "0";
    } else {
      chars[i] = String(Number(chars[i]) + 1);
      return chars.join("");
    }
  }
  return "1" + chars.join("");
}

/**
 * `x` rounded to exactly `decimals` places as an en-US digit string with no grouping, such as
 * "-1234.50". Rounds the shortest round-trip decimal (1.005 → "1.01"), never writes exponent
 * notation, keeps a "-" on negative values that round to zero (like Intl), and reads non-finite
 * values as 0. Matches `Intl.NumberFormat` with `roundingMode` halfExpand, floor, or ceil.
 */
export function roundDecimal(x: number, decimals: number, mode: RoundingMode = "nearest"): string {
  const d = Number.isFinite(decimals) ? Math.min(100, Math.max(0, Math.floor(decimals))) : 0;
  const { negative, int, frac } = decimalParts(Number.isFinite(x) ? x : 0);
  const kept = int + frac.slice(0, d).padEnd(d, "0");
  const dropped = frac.slice(d);
  const anyDropped = /[1-9]/.test(dropped);
  let roundUp = false;
  if (mode === "nearest") roundUp = dropped.length > 0 && dropped[0]! >= "5";
  else if (mode === "down") roundUp = negative && anyDropped;
  else roundUp = !negative && anyDropped;
  const digits = roundUp ? incrementDigits(kept) : kept;
  const intPart = digits.slice(0, digits.length - d) || "0";
  const fracPart = digits.slice(digits.length - d);
  return (negative ? "-" : "") + intPart + (d > 0 ? `.${fracPart}` : "");
}

/** Insert `separator` between thousands in a string of integer digits: "1234567" → "1,234,567". */
export function groupThousands(digits: string, separator = ","): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/** Left-pad integer digits with zeros to at least `minimumDigits`. */
export function padInteger(digits: string, minimumDigits: number): string {
  return digits.padStart(Math.max(1, Math.floor(minimumDigits)), "0");
}

/** Escape text for use inside a RegExp (valid with the `u` flag). */
export function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}
