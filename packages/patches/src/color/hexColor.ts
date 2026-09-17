/** Hex Color: a 3, 4, 6, or 8-digit hex code as a color, with alpha last as in CSS. */

import type { Color } from "@sonobe/core";
import { definePatch, toText } from "../infra/index.ts";

const HEX_DIGITS = /^[0-9A-Fa-f]+$/;
const VALID_LENGTHS: ReadonlySet<number> = new Set([3, 4, 6, 8]);

/**
 * Parse a hex code: 3 (RGB), 4 (RGBA), 6 (RRGGBB), or 8 (RRGGBBAA) digits, at most one leading "#",
 * surrounding whitespace ignored. Undefined for anything else (names, rgb(), 0x, inner spaces).
 */
export function parseHexCode(text: string): Color | undefined {
  let digits = text.trim();
  if (digits.startsWith("#")) digits = digits.slice(1);
  if (!HEX_DIGITS.test(digits) || !VALID_LENGTHS.has(digits.length)) return undefined;
  if (digits.length <= 4) digits = [...digits].map((d) => d + d).join("");
  if (digits.length === 6) digits += "FF";
  const byte = (i: number) => parseInt(digits.slice(2 * i, 2 * i + 2), 16) / 255;
  return { r: byte(0), g: byte(1), b: byte(2), a: byte(3) };
}

export const hexColorPatch = definePatch("hexColor", {
  evaluate(ctx) {
    // Partial codes are normal while someone types, so invalid text never warns.
    const color = parseHexCode(toText(ctx.input("hex")));
    ctx.output("color", color ?? { r: 0, g: 0, b: 0, a: 0 });
    ctx.output("valid", color !== undefined);
  },
});
