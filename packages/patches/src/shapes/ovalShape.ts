/** Oval Shape: an exact ellipse as four clockwise elliptical quarter arcs, starting at the top center. */

import { definePatch } from "../infra/index.ts";
import { ellipsePath } from "./path.ts";
import { emptyShape, readPair } from "./read.ts";

export const ovalShape = definePatch("ovalShape", {
  evaluate(ctx) {
    const [px, py] = readPair(ctx, "position");
    const [ax, ay] = readPair(ctx, "anchor");
    const [sw, sh] = readPair(ctx, "size");
    const w = Math.max(0, sw);
    const h = Math.max(0, sh);
    if (w === 0 || h === 0) {
      ctx.output("shape", emptyShape());
      return;
    }
    // Move from the anchor point to the center of the w × h box.
    ctx.output("shape", { path: ellipsePath(px + (0.5 - ax) * w, py + (0.5 - ay) * h, w / 2, h / 2) });
  },
});
