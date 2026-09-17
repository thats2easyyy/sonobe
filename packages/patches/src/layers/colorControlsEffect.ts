/** Color Controls Effect: a `"colorControls"` layer effect (brightness, contrast, saturation, hue rotation). */

import type { LayerEffectValue } from "@sonobe/core";
import { definePatch, warnOnce } from "../infra/index.ts";

export const colorControlsEffect = definePatch("colorControlsEffect", {
  evaluate(ctx) {
    const num = (key: string, neutral: number): number => {
      const v = ctx.input<unknown>(key);
      if (typeof v === "number" && Number.isFinite(v)) return v;
      warnOnce(ctx, `nonFinite:${key}`, `Color Controls Effect: ${key} isn't a finite number; using ${neutral}.`);
      return neutral;
    };
    const effect: LayerEffectValue = {
      kind: "colorControls",
      params: {
        brightness: Math.max(-1, num("brightness", 0)),
        contrast: Math.max(0, num("contrast", 1)),
        saturation: Math.max(0, num("saturation", 1)),
        hue: num("hueRotation", 0),
      },
    };
    ctx.output("effect", effect);
  },
});
