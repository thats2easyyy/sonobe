/** Glass Effect: a `"glass"` layer effect with Intensity folded into every param. */

import type { Color, LayerEffectValue } from "@sonobe/core";
import { clamp01, definePatch, warnOnce } from "../infra/index.ts";

const LABELS: Readonly<Record<string, string>> = {
  intensity: "Intensity",
  frost: "Frost",
  tint: "Tint",
  refraction: "Refraction",
  highlight: "Highlight",
  saturation: "Saturation",
  depth: "Depth",
};

export const glassEffect = definePatch("glassEffect", {
  evaluate(ctx) {
    const finiteOr = (key: string, value: unknown, neutral: number): number => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      warnOnce(ctx, `nonFinite:${key}`, `Glass Effect: ${LABELS[key] ?? key} isn't a finite number; using ${neutral}.`);
      return neutral;
    };
    const input = (key: string, neutral: number) => finiteOr(key, ctx.input<unknown>(key), neutral);
    const k = clamp01(input("intensity", 1));
    const raw = ctx.input<Partial<Color> | null>("tint");
    const tint: Color = {
      r: finiteOr("tint", raw?.r ?? 0, 0),
      g: finiteOr("tint", raw?.g ?? 0, 0),
      b: finiteOr("tint", raw?.b ?? 0, 0),
      a: finiteOr("tint", raw?.a ?? 0, 0) * k,
    };
    const saturation = Math.max(0, input("saturation", 1));
    const effect: LayerEffectValue = {
      kind: "glass",
      params: {
        frost: Math.max(0, input("frost", 0)) * k,
        tint,
        refraction: clamp01(input("refraction", 0)) * k,
        highlight: clamp01(input("highlight", 0)) * k,
        saturation: 1 + (saturation - 1) * k,
        depth: Math.max(0, input("depth", 0)),
      },
    };
    ctx.output("effect", effect);
  },
});
