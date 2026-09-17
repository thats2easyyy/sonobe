/** Cubic Bezier Curve: reshapes progress with a CSS cubic-bezier easing, extended in straight lines outside 0–1. */

import { definePatch, warnOnce } from "../infra/index.ts";
import { cubicBezierEase, readBezierControls } from "./shared.ts";

export const cubicBezierCurve = definePatch("cubicBezierCurve", {
  evaluate(ctx) {
    const [x1, y1, x2, y2] = readBezierControls(ctx, "Cubic Bezier Curve");
    const p = ctx.input<number>("progress");
    const y = cubicBezierEase(x1, y1, x2, y2, p);
    if (Number.isFinite(p) && Number.isFinite(y)) {
      ctx.output("output", y);
      ctx.output("curvePoint", [p, y]);
    } else {
      warnOnce(ctx, "progress", "Cubic Bezier Curve got a Progress or control point too large to use, so it outputs 0.");
      ctx.output("output", 0);
      ctx.output("curvePoint", [0, 0]);
    }
  },
});
