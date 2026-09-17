/** Circle Shape: an exact circle as four clockwise quarter arcs, starting at 12 o'clock. */

import { definePatch } from "../infra/index.ts";
import { ellipsePath } from "./path.ts";
import { emptyShape, readNumber, readPair } from "./read.ts";

export const circleShape = definePatch("circleShape", {
  evaluate(ctx) {
    const [px, py] = readPair(ctx, "position");
    const [ax, ay] = readPair(ctx, "anchor");
    const r = Math.max(0, readNumber(ctx, "radius"));
    if (r === 0) {
      ctx.output("shape", emptyShape());
      return;
    }
    // Move from the anchor point to the center of the circle's 2r × 2r box.
    ctx.output("shape", { path: ellipsePath(px + (0.5 - ax) * 2 * r, py + (0.5 - ay) * 2 * r, r, r) });
  },
});
