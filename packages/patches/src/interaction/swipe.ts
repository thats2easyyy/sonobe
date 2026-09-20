/** Swipe: judges each press on release as a swipe left, right, up, or down, optionally from where it's heading. */

import type { PatchContext, PointerSnapshot } from "@sonobe/engine";
import { definePatch, finiteOr } from "../infra/index.ts";
import { TOUCH_SLOP, layerInput } from "./shared.ts";

interface SwipeState {
  blocked: boolean;
}

/**
 * Translation carried `lookahead` seconds along the velocity: the linear projection Snap makes
 * (POP decay from speed v at rate r travels v·r / (1000(1 − r)), so Normal is 0.499 s, Fast 0.099 s).
 */
function project(translation: readonly number[], velocity: readonly number[], lookahead: number): [number, number] {
  return [translation[0]! + velocity[0]! * lookahead, translation[1]! + velocity[1]! * lookahead];
}

function judge(ctx: PatchContext<SwipeState>, snap: PointerSnapshot, projected: readonly [number, number]): void {
  const [tx, ty] = snap.translation;
  const [vx, vy] = snap.velocity;
  const [px, py] = projected;
  const axis = ctx.input<string>("axis");
  // Any Direction follows where the press is heading; with Lookahead 0 that is where it traveled.
  const horizontal = axis === "horizontal" || (axis !== "vertical" && Math.abs(px) >= Math.abs(py));
  const distance = horizontal ? tx : ty;
  const velocity = horizontal ? vx : vy;
  const heading = horizontal ? px : py;
  if (!(Math.abs(distance) >= TOUCH_SLOP)) return; // taps and small wiggles never swipe
  const minVelocity = Math.max(0, finiteOr(ctx.input("minVelocity"), 0));
  const minDistance = Math.max(0, finiteOr(ctx.input("minDistance"), 0));
  let direction = 0;
  if (velocity !== 0 && Math.abs(velocity) >= minVelocity) direction = Math.sign(velocity);
  else if (Math.abs(heading) >= minDistance) direction = Math.sign(heading);
  if (direction === 0 || Number.isNaN(direction)) return;
  ctx.pulse("swiped");
  if (horizontal) ctx.pulse(direction < 0 ? "swipedLeft" : "swipedRight");
  else ctx.pulse(direction < 0 ? "swipedUp" : "swipedDown");
}

export const swipe = definePatch<SwipeState>("swipe", {
  state: () => ({ blocked: false }),
  evaluate(ctx) {
    const state = ctx.state;
    const snap = ctx.services.pointer(layerInput(ctx));
    const enabled = ctx.input<boolean>("enabled") === true;
    if (!enabled && (snap.down || snap.ended)) state.blocked = true;
    const live = enabled && !state.blocked;
    const active = live && (snap.down || snap.ended); // pressed now, or released this frame (as Gesture)
    const lookahead = Math.max(0, finiteOr(ctx.input("lookahead"), 0));
    const projected: [number, number] = active ? project(snap.translation, snap.velocity, lookahead) : [0, 0];
    ctx.output("projected", projected);
    if (live && snap.ended && !snap.cancelled) judge(ctx, snap, projected); // a cancelled press (the browser took over) never swipes
    if (!snap.down) state.blocked = false;
  },
  mutedBehavior: "zero",
});
