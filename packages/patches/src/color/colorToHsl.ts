/** Color to HSL: a color's hue, saturation, lightness, and alpha (the inverse of HSL Color). */

import { definePatch } from "../infra/index.ts";
import { clampColor } from "./channels.ts";

/**
 * HSL for RGB channels in 0–1: hue in [0, 1), saturation and lightness in [0, 1]. Grays have hue
 * and saturation 0; when channels tie for the maximum, red wins, then green.
 */
export function rgbToHsl(r: number, g: number, b: number): [h: number, s: number, l: number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = Math.min(1, d / (1 - Math.abs(2 * l - 1)));
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h >= 1) h = 0;
  }
  return [h, s, l];
}

export const colorToHslPatch = definePatch("colorToHsl", {
  evaluate(ctx) {
    const c = clampColor(ctx, ctx.input("color"), "Color to HSL");
    const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
    ctx.output("hue", h);
    ctx.output("saturation", s);
    ctx.output("lightness", l);
    ctx.output("alpha", c.a);
  },
});
