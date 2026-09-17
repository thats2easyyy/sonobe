/** Touches: every pressed finger as loops of positions, pressures, and ids. */

import type { LayerRef } from "@sonobe/core";
import type { PatchContext, RuntimeServices } from "@sonobe/engine";
import { clamp01, definePatch, loopOf, warnOnce } from "../infra/index.ts";
import { finitePoint, layerInput, type Vec2 } from "./shared.ts";

/** One pressed pointer as Touches reports it. */
export interface Touch {
  id: number;
  position: Vec2;
  /** 0–1. */
  pressure: number;
  /** Prototype time in seconds when the press began. */
  startTime: number;
}

const finiteNumber = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/**
 * Pressed pointers whose press began on `ref` or a descendant (every pressed pointer when null), from
 * `services.pointers`, ordered by press time then id. Pointers with non-finite coordinates are skipped.
 */
export function pressedTouches(services: RuntimeServices, ref: LayerRef | null): Touch[] {
  const out: Touch[] = [];
  for (const p of services.pointers(ref) ?? []) {
    const position = finitePoint(p.position);
    if (!position) continue;
    out.push({ id: finiteNumber(p.id, 0), position, pressure: clamp01(finiteNumber(p.pressure, 0)), startTime: finiteNumber(p.startTime, 0) });
  }
  return out.sort((a, b) => a.startTime - b.startTime || a.id - b.id);
}

function emitIdle(ctx: PatchContext<undefined>): void {
  ctx.output("positions", loopOf([]));
  ctx.output("pressures", loopOf([]));
  ctx.output("ids", loopOf([]));
  ctx.output("count", 0);
  ctx.output("json", []);
}

export const touches = definePatch("touches", {
  evaluate(ctx) {
    if (ctx.muted || ctx.input<boolean>("enabled") !== true) {
      emitIdle(ctx);
      return;
    }
    if (ctx.inputItems("layer").length > 1) warnOnce(ctx, "loopedLayer", "Touches watches one layer, so it uses the first item of the looped Layer.");
    const list = pressedTouches(ctx.services, layerInput(ctx));
    ctx.output("positions", loopOf(list.map((t) => t.position)));
    ctx.output("pressures", loopOf(list.map((t) => t.pressure)));
    ctx.output("ids", loopOf(list.map((t) => t.id)));
    ctx.output("count", list.length);
    ctx.output(
      "json",
      list.map((t) => ({ id: t.id, position: [t.position[0], t.position[1]], pressure: t.pressure })),
    );
  },
  mutedBehavior: "evaluate",
});
