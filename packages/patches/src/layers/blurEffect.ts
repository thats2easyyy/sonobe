/** Blur Effect: a `"blur"` layer effect value for a layer's Effects property. */

import type { LayerEffectValue } from "@sonobe/core";
import { definePatch, warnOnce } from "../infra/index.ts";

export const blurEffect = definePatch("blurEffect", {
  evaluate(ctx) {
    let radius = ctx.input<unknown>("radius");
    if (typeof radius !== "number" || !Number.isFinite(radius)) {
      warnOnce(ctx, "nonFinite:radius", "Blur Effect: Radius isn't a finite number; using 0.");
      radius = 0;
    }
    const effect: LayerEffectValue = {
      kind: "blur",
      params: { radius: Math.max(0, radius as number), hardEdges: ctx.input<unknown>("hardEdges") === true },
    };
    ctx.output("effect", effect);
  },
});
