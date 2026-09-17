/** Curve: reshapes progress with an easing curve, continuing in a straight tangent line outside 0–1. */

import { definePatch, easeExtended, isKnownCurve, warnOnce } from "../infra/index.ts";

export const curve = definePatch("curve", {
  evaluate(ctx) {
    const key = String(ctx.input("curve") ?? "");
    if (!isKnownCurve(key)) warnOnce(ctx, "curve", `Curve doesn't know a curve named "${key}", so it uses Linear.`);
    const p = ctx.input<number>("progress");
    const out = easeExtended(key, p);
    if (Number.isFinite(p) && Number.isFinite(out)) {
      ctx.output("output", out);
    } else {
      warnOnce(ctx, "progress", "Curve got a Progress that isn't finite, so it outputs 0.");
      ctx.output("output", 0);
    }
  },
});
