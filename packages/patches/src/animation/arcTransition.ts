/** Arc Transition: the quadratic through Start (progress 0), Middle (0.5), and End (1), component-wise. */

import { components, definePatch, fromComponents, warnOnce } from "../infra/index.ts";
import { requireSpec, variantOf, withMutedBehavior } from "./shared.ts";

const SPEC = requireSpec("arcTransition");

export const arcTransition = withMutedBehavior(
  definePatch("arcTransition", {
    evaluate(ctx) {
      const type = variantOf(ctx, SPEC);
      const startValue = ctx.input("start");
      if (ctx.node.muted) {
        ctx.output("output", startValue);
        return;
      }
      const p = ctx.input<number>("progress");
      const s = components(startValue, type);
      const m = components(ctx.input("middle"), type);
      const e = components(ctx.input("end"), type);
      const q = 1 - p;
      const out = new Array<number>(s.length);
      for (let i = 0; i < s.length; i++) {
        const si = s[i]!;
        const ei = e[i] ?? 0;
        const control = 2 * (m[i] ?? 0) - (si + ei) / 2;
        const v = q * q * si + 2 * p * q * control + p * p * ei;
        if (Number.isFinite(v)) {
          out[i] = v;
        } else {
          out[i] = 0;
          warnOnce(ctx, "nonFinite", "Arc Transition got a value that isn't finite, so it outputs 0 for that part.");
        }
      }
      ctx.output("output", fromComponents(out, type));
    },
  }),
  // The runtime's type-matching bypass would pass Progress through for the number variant; muted Arc Transition passes Start.
  "evaluate",
);
