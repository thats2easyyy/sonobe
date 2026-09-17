/** Color to Hex: a color as "#RRGGBB" text, or "#RRGGBBAA" while Include Alpha is on. */

import { definePatch, toBool } from "../infra/index.ts";
import { finiteOrZero, hexByte, readColor } from "./channels.ts";

export const colorToHexPatch = definePatch("colorToHex", {
  evaluate(ctx) {
    const c = readColor(ctx.input("color"));
    const byte = (x: number) => hexByte(finiteOrZero(ctx, x, "channel", "Color to Hex: a color channel isn't a finite number, so it counts as 0."));
    let hex = `#${byte(c.r)}${byte(c.g)}${byte(c.b)}`;
    if (toBool(ctx.input("includeAlpha"))) hex += byte(c.a);
    ctx.output("hex", hex);
  },
});
