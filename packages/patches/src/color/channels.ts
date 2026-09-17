/**
 * Channel helpers shared by the color patches: finite checks that count problems as 0 and warn
 * once per restart, clamping to 0–1, reading any value as straight RGBA, and hex bytes.
 */

import type { Color } from "@sonobe/core";
import { isColor } from "@sonobe/core";
import type { OnceContext } from "../infra/index.ts";
import { clamp01, components, warnOnce } from "../infra/index.ts";

/** `value` when it's a finite number; otherwise 0, with one warning per restart under `key`. */
export function finiteOrZero(ctx: OnceContext, value: unknown, key: string, message: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  warnOnce(ctx, key, message);
  return 0;
}

/** A value as straight RGBA channels (colors as they are, "#RRGGBBAA" text parsed, vectors as r, g, b, a). */
export function readColor(value: unknown): Color {
  if (isColor(value)) return value;
  const [r = 0, g = 0, b = 0, a = 0] = components(value, "color");
  return { r, g, b, a };
}

/** Each channel clamped to 0–1; a non-finite channel counts as 0 and warns once per restart. */
export function clampColor(ctx: OnceContext, value: unknown, patchName: string): Color {
  const c = readColor(value);
  const channel = (x: number) => clamp01(finiteOrZero(ctx, x, "channel", `${patchName}: a color channel isn't a finite number, so it counts as 0.`));
  return { r: channel(c.r), g: channel(c.g), b: channel(c.b), a: channel(c.a) };
}

/** A 0–1 channel as two uppercase hex digits: round(clamp(x) × 255). */
export function hexByte(x: number): string {
  return Math.round(clamp01(x) * 255)
    .toString(16)
    .toUpperCase()
    .padStart(2, "0");
}
