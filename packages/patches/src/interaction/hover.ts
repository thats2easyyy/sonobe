/** Hover: whether the mouse pointer is over a layer or the prototype, and where it is. */

import type { PatchContext, PointerSnapshot } from "@sonobe/engine";
import type { LayerRef } from "@sonobe/core";
import { definePatch } from "../infra/index.ts";
import { layerInput, withMutedBehavior, type Vec2 } from "./shared.ts";

interface HoverState {
  lastPosition: Vec2;
  lastLocal: Vec2;
}

function inside(point: readonly number[], width: number, height: number): boolean {
  const [x, y] = point;
  return x !== undefined && y !== undefined && x >= Math.min(0, width) && x <= Math.max(0, width) && y >= Math.min(0, height) && y <= Math.max(0, height);
}

/**
 * The engine's snapshot drops a pointer from hover tracking while it's pressed, but a held mouse
 * button should keep hovering (CSS `:hover`). A press that began on the layer counts while the pointer
 * stays inside the layer's bounds (previous frame's layout).
 */
function isHovering(ctx: PatchContext<HoverState>, ref: LayerRef | null, snap: PointerSnapshot): boolean {
  if (ref === null) {
    const [width, height] = ctx.services.device().screenSize;
    return (snap.hovering || snap.down) && inside(snap.position, width, height);
  }
  if (snap.hovering) return true;
  if (!snap.down) return false;
  const size = ctx.services.layerInfo(ref)?.size;
  return size !== undefined && inside(snap.localPosition, size[0], size[1]);
}

export const hover = withMutedBehavior(
  definePatch<HoverState>("hover", {
    state: () => ({ lastPosition: [0, 0], lastLocal: [0, 0] }),
    evaluate(ctx) {
      const state = ctx.state;
      const ref = layerInput(ctx);
      const snap = ctx.services.pointer(ref);
      const hovering = ctx.input<boolean>("enabled") === true && isHovering(ctx, ref, snap);
      if (hovering) {
        state.lastPosition = [snap.position[0], snap.position[1]];
        state.lastLocal = [snap.localPosition[0], snap.localPosition[1]];
      }
      ctx.output("hovering", hovering);
      ctx.output("position", state.lastPosition);
      ctx.output("localPosition", state.lastLocal);
    },
  }),
  "zero",
);
