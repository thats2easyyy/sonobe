/**
 * Color conversions for pickers and swatches. Colors are straight RGBA in 0..1 (the core
 * runtime `Color`), serialized as "#RRGGBBAA" in documents.
 */

import type { Color } from "@sonobe/core";

/** Hue in degrees [0, 360), saturation/value/alpha in 0..1. */
export interface HSVA {
  h: number;
  s: number;
  v: number;
  a: number;
}

export const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Parse "#RGB", "#RGBA", "#RRGGBB", or "#RRGGBBAA" (the "#" is optional). */
export function parseHexColor(input: string): Color | null {
  const match = /^#?([0-9a-f]+)$/i.exec(input.trim());
  if (!match) return null;
  let hex = match[1] ?? "";
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
  if (hex.length === 6) hex += "ff";
  if (hex.length !== 8) return null;
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return { r: channel(0), g: channel(2), b: channel(4), a: channel(6) };
}

const byte = (n: number) =>
  Math.round(clamp01(n) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();

/** "#RRGGBBAA" (document encoding). */
export function toHex8(c: Color): string {
  return `#${byte(c.r)}${byte(c.g)}${byte(c.b)}${byte(c.a)}`;
}

/** "#RRGGBB" (alpha dropped). */
export function toHex6(c: Color): string {
  return `#${byte(c.r)}${byte(c.g)}${byte(c.b)}`;
}

/** CSS color string with alpha, e.g. "rgb(255 128 0 / 0.5)". */
export function toCssColor(c: Color): string {
  const to255 = (n: number) => Math.round(clamp01(n) * 255);
  return `rgb(${to255(c.r)} ${to255(c.g)} ${to255(c.b)} / ${Math.round(clamp01(c.a) * 1000) / 1000})`;
}

export function rgbaToHsva(c: Color): HSVA {
  const r = clamp01(c.r);
  const g = clamp01(c.g);
  const b = clamp01(c.b);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max, a: clamp01(c.a) };
}

export function hsvaToRgba({ h, s, v, a }: HSVA): Color {
  const hue = (((h % 360) + 360) % 360) / 60;
  const sat = clamp01(s);
  const val = clamp01(v);
  const chroma = val * sat;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const m = val - chroma;
  const sector = Math.floor(hue);
  const [r1, g1, b1] =
    sector === 0 ? [chroma, x, 0]
    : sector === 1 ? [x, chroma, 0]
    : sector === 2 ? [0, chroma, x]
    : sector === 3 ? [0, x, chroma]
    : sector === 4 ? [x, 0, chroma]
    : [chroma, 0, x];
  return { r: r1 + m, g: g1 + m, b: b1 + m, a: clamp01(a) };
}

/** True when two colors round to the same 8-bit RGBA. */
export function colorsEqual(a: Color, b: Color): boolean {
  return toHex8(a) === toHex8(b);
}

/** WCAG relative luminance of the opaque color. */
export function relativeLuminance(c: Color): number {
  const lin = (n: number) => {
    const v = clamp01(n);
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** Whether light or dark foreground reads better on this color. */
export function readableForeground(c: Color): "light" | "dark" {
  return relativeLuminance(c) > 0.4 ? "dark" : "light";
}
