/** RGB Color: a color from gamma-encoded sRGB channels and straight alpha, each clamped to 0–1. */

import { clamp01, definePatch } from "../infra/index.ts";
import { finiteOrZero } from "./channels.ts";

const CHANNELS = [
  ["red", "Red"],
  ["green", "Green"],
  ["blue", "Blue"],
  ["alpha", "Alpha"],
] as const;

export const rgbColorPatch = definePatch("rgbColor", {
  evaluate(ctx) {
    const [r, g, b, a] = CHANNELS.map(([key, name]) => clamp01(finiteOrZero(ctx, ctx.input(key), key, `RGB Color: ${name} isn't a finite number, so it counts as 0.`)));
    ctx.output("color", { r: r!, g: g!, b: b!, a: a! });
  },
});
