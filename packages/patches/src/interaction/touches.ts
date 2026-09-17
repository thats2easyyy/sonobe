/** Touches: every pressed finger as loops of positions, pressures, and ids. */

import type { LayerRef } from "@sonobe/core";
import type { PatchContext, RuntimeServices } from "@sonobe/engine";
import { definePatch, loopOf, warnOnce } from "../infra/index.ts";
import { finitePoint, layerInput, withMutedBehavior, type Vec2 } from "./shared.ts";

/** One pressed pointer, as the proposed `RuntimeServices.pointers(layer)` would report it. */
export interface TouchPoint {
  id: number;
  position: [number, number];
  pressure: number;
  startTime: number;
}

type PointersService = (layer: LayerRef | null) => readonly Partial<TouchPoint>[];

interface Touch {
  id: number;
  position: Vec2;
  pressure: number;
  startTime: number;
}

/**
 * Pressed pointers for `ref`, ordered by press time then id. Uses `services.pointers` when the host
 * provides it (a proposed contract addition); otherwise the single tracked pointer while pressed.
 */
function pressedPointers(services: RuntimeServices, ref: LayerRef | null): Touch[] {
  const pointers = (services as { pointers?: PointersService }).pointers;
  if (typeof pointers === "function") {
    const out: Touch[] = [];
    for (const p of pointers(ref) ?? []) {
      const position = finitePoint(p.position);
      if (!position) continue;
      const id = typeof p.id === "number" && Number.isFinite(p.id) ? p.id : 0;
      const pressure = typeof p.pressure === "number" && Number.isFinite(p.pressure) ? p.pressure : 1;
      const startTime = typeof p.startTime === "number" && Number.isFinite(p.startTime) ? p.startTime : 0;
      out.push({ id, position, pressure, startTime });
    }
    return out.sort((a, b) => a.startTime - b.startTime || a.id - b.id);
  }
  const snap = services.pointer(ref);
  const position = snap.down ? finitePoint(snap.position) : null;
  return position ? [{ id: 0, position, pressure: 1, startTime: 0 }] : [];
}

function emitIdle(ctx: PatchContext<undefined>): void {
  ctx.output("positions", loopOf([]));
  ctx.output("pressures", loopOf([]));
  ctx.output("ids", loopOf([]));
  ctx.output("count", 0);
  ctx.output("json", []);
}

export const touches = withMutedBehavior(
  definePatch("touches", {
    evaluate(ctx) {
      if (ctx.node.muted || ctx.input<boolean>("enabled") !== true) {
        emitIdle(ctx);
        return;
      }
      if (ctx.inputItems("layer").length > 1) warnOnce(ctx, "loopedLayer", "Touches watches one layer, so it uses the first item of the looped Layer.");
      const ref = layerInput(ctx);
      const list = pressedPointers(ctx.services, ref);
      const hasPointers = typeof (ctx.services as { pointers?: unknown }).pointers === "function";
      ctx.output("positions", loopOf(list.map((t) => t.position)));
      ctx.output("pressures", loopOf(list.map((t) => t.pressure)));
      ctx.output("ids", loopOf(list.map((t) => t.id)));
      ctx.output("count", hasPointers ? list.length : list.length > 0 ? Math.max(1, ctx.services.pointer(ref).pointerCount) : 0);
      ctx.output(
        "json",
        list.map((t) => ({ id: t.id, position: [t.position[0], t.position[1]], pressure: t.pressure })),
      );
    },
  }),
  "evaluate",
);
