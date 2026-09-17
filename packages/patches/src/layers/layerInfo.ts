/** Layer Info: a layer's previous-frame geometry from `services.layerInfo`. */

import type { LayerRef } from "@sonobe/core";
import type { PatchContext } from "@sonobe/engine";
import { definePatch, warnOnce } from "../infra/index.ts";

const LABELS: Readonly<Record<string, string>> = { size: "Size", position: "Position", scale: "Scale", anchor: "Anchor", contentSize: "Content Size" };

/** Replace each non-finite component with `fallback`, warning once per restart. */
function finitePair(ctx: PatchContext, key: string, value: readonly number[] | undefined, fallback = 0): [number, number] {
  const x = value?.[0];
  const y = value?.[1];
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!ok(x) || !ok(y)) warnOnce(ctx, `nonFinite:${key}`, `Layer Info: ${LABELS[key] ?? key} isn't a finite number; using ${fallback}.`);
  return [ok(x) ? x : fallback, ok(y) ? y : fallback];
}

/** Missing-layer values: Scale 1 so math that multiplies by it doesn't collapse. */
function outputMissing(ctx: PatchContext): void {
  ctx.output("size", [0, 0]);
  ctx.output("position", [0, 0]);
  ctx.output("scale", 1);
  ctx.output("anchor", [0, 0]);
  ctx.output("enabled", false);
  ctx.output("parent", null);
  ctx.output("contentSize", [0, 0]);
}

export const layerInfo = definePatch("layerInfo", {
  // Muted: every output takes the missing-layer values (the default bypass would pass Layer into Parent).
  mutedBehavior: "evaluate",
  evaluate(ctx) {
    if (ctx.muted) {
      outputMissing(ctx);
      return;
    }
    const ref = ctx.input<LayerRef | null>("layer");
    const info = ref && typeof ref.layerId === "string" ? ctx.services.layerInfo(ref) : undefined;
    if (!ref || !info) {
      outputMissing(ctx);
      return;
    }
    ctx.output("size", finitePair(ctx, "size", info.size));
    ctx.output("position", finitePair(ctx, "position", info.position));
    const sx = info.scale?.[0];
    if (typeof sx === "number" && Number.isFinite(sx)) {
      ctx.output("scale", sx);
    } else {
      warnOnce(ctx, "nonFinite:scale", "Layer Info: Scale isn't a finite number; using 1.");
      ctx.output("scale", 1);
    }
    ctx.output("anchor", finitePair(ctx, "anchor", info.anchor));
    ctx.output("enabled", info.enabled === true);
    // The engine scopes the parent reference like the child's (loop instance, component prefix), so pass it on as is.
    ctx.output("parent", info.parent ?? null);
    ctx.output("contentSize", finitePair(ctx, "contentSize", info.contentSize));
  },
});
