/** Transition: blends Start to End by Progress, component-wise and unclamped (colors clamp per channel). */

import { components, definePatch, fromComponents, warnOnce } from "../infra/index.ts";
import { requireSpec, variantOf, withMutedBehavior } from "./shared.ts";

const SPEC = requireSpec("transition");

export const transition = withMutedBehavior(
  definePatch("transition", {
    evaluate(ctx) {
      const type = variantOf(ctx, SPEC);
      const start = ctx.input("start");
      if (ctx.node.muted) {
        ctx.output("output", start);
        return;
      }
      let p = ctx.input<number>("progress");
      if (!Number.isFinite(p)) {
        warnOnce(ctx, "progress", "Transition got a Progress that isn't finite, so it outputs Start.");
        p = 0;
      }
      const a = components(start, type);
      const b = components(ctx.input("end"), type);
      const out = new Array<number>(a.length);
      for (let i = 0; i < a.length; i++) {
        const ai = a[i]!;
        const bi = b[i] ?? 0;
        const v = ai + p * (bi - ai);
        if (Number.isFinite(v)) {
          out[i] = v;
        } else {
          out[i] = 0;
          warnOnce(ctx, "nonFinite", "Transition got a Start or End that isn't finite, so it outputs 0 for that part.");
        }
      }
      ctx.output("output", fromComponents(out, type));
    },
  }),
  // The runtime's type-matching bypass would pass Progress through for the number variant; muted Transition passes Start.
  "evaluate",
);
