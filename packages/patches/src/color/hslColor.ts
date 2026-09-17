/** HSL Color: a color from hue (0–1, wrapping), saturation, lightness, and alpha (CSS Color 4 conversion). */

import { clamp01, definePatch } from "../infra/index.ts";
import { finiteOrZero } from "./channels.ts";

/** RGB channels for HSL, each 0–1. Hue wraps to its fractional part; the other inputs clamp to 0–1. */
export function hslToRgb(hue: number, saturation: number, lightness: number): [r: number, g: number, b: number] {
  const h = hue - Math.floor(hue);
  const s = clamp01(saturation);
  const l = clamp01(lightness);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return clamp01(l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

const INPUTS = [
  ["hue", "Hue"],
  ["saturation", "Saturation"],
  ["lightness", "Lightness"],
  ["alpha", "Alpha"],
] as const;

export const hslColorPatch = definePatch("hslColor", {
  evaluate(ctx) {
    const [h, s, l, a] = INPUTS.map(([key, name]) => finiteOrZero(ctx, ctx.input(key), key, `HSL Color: ${name} isn't a finite number, so it counts as 0.`));
    const [r, g, b] = hslToRgb(h!, s!, l!);
    ctx.output("color", { r, g, b, a: clamp01(a!) });
  },
});
