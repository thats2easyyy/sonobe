/** Color to RGB: a color's straight sRGB channels and alpha, each clamped to 0–1. */

import { definePatch } from "../infra/index.ts";
import { clampColor } from "./channels.ts";

export const colorToRgbPatch = definePatch("colorToRgb", {
  evaluate(ctx) {
    const c = clampColor(ctx, ctx.input("color"), "Color to RGB");
    ctx.output("red", c.r);
    ctx.output("green", c.g);
    ctx.output("blue", c.b);
    ctx.output("alpha", c.a);
  },
});
