/** Swipe: judges each press on release as a swipe left, right, up, or down. */

import type { PatchContext, PointerSnapshot } from "@sonobe/engine";
import { definePatch, finiteOr } from "../infra/index.ts";
import { TOUCH_SLOP, layerInput, withMutedBehavior } from "./shared.ts";

interface SwipeState {
  blocked: boolean;
}

/** True when the snapshot says the press was cancelled (a field the contract doesn't have yet). */
function wasCancelled(snap: PointerSnapshot): boolean {
  return (snap as { cancelled?: unknown }).cancelled === true;
}

function judge(ctx: PatchContext<SwipeState>, snap: PointerSnapshot): void {
  const [tx, ty] = snap.translation;
  const [vx, vy] = snap.velocity;
  const axis = ctx.input<string>("axis");
  const horizontal = axis === "horizontal" || (axis !== "vertical" && Math.abs(tx) >= Math.abs(ty));
  const distance = horizontal ? tx : ty;
  const velocity = horizontal ? vx : vy;
  if (!(Math.abs(distance) >= TOUCH_SLOP)) return; // taps and small wiggles never swipe
  const minVelocity = Math.max(0, finiteOr(ctx.input("minVelocity"), 0));
  const minDistance = Math.max(0, finiteOr(ctx.input("minDistance"), 0));
  let direction = 0;
  if (velocity !== 0 && Math.abs(velocity) >= minVelocity) direction = Math.sign(velocity);
  else if (Math.abs(distance) >= minDistance) direction = Math.sign(distance);
  if (direction === 0 || Number.isNaN(direction)) return;
  ctx.pulse("swiped");
  if (horizontal) ctx.pulse(direction < 0 ? "swipedLeft" : "swipedRight");
  else ctx.pulse(direction < 0 ? "swipedUp" : "swipedDown");
}

export const swipe = withMutedBehavior(
  definePatch<SwipeState>("swipe", {
    state: () => ({ blocked: false }),
    evaluate(ctx) {
      const state = ctx.state;
      const snap = ctx.services.pointer(layerInput(ctx));
      const enabled = ctx.input<boolean>("enabled") === true;
      if (!enabled && (snap.down || snap.ended)) state.blocked = true;
      if (enabled && !state.blocked && snap.ended && !wasCancelled(snap)) judge(ctx, snap);
      if (!snap.down) state.blocked = false;
    },
  }),
  "zero",
);
