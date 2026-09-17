/** Triangle Shape: three corner points joined in order and closed. */

import { definePatch } from "../infra/index.ts";
import { cmd } from "./path.ts";
import { readPair } from "./read.ts";

export const triangleShape = definePatch("triangleShape", {
  evaluate(ctx) {
    const p1 = readPair(ctx, "firstPoint");
    const p2 = readPair(ctx, "secondPoint");
    const p3 = readPair(ctx, "thirdPoint");
    ctx.output("shape", { path: [cmd("M", ...p1), cmd("L", ...p2), cmd("L", ...p3), "Z"].join(" ") });
  },
});
