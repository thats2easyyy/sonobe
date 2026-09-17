/** Momentum Scrolling: follows a value while tracking, then coasts, and rubber-bands into range. */

import { MomentumScroller } from "@sonobe/engine";
import type { MomentumScrollerOptions } from "@sonobe/engine";
import { clamp, definePatch, finiteOr } from "../infra/index.ts";
import { finiteInput } from "./shared.ts";

interface MomentumScrollingState {
  scroller: MomentumScroller | null;
}

/** Scrolling Friction (1–100) → velocity kept per millisecond: 4 → 0.998, 20 → 0.99, 100 → 0.95. */
export function scrollingDeceleration(scrollingFriction: number): number {
  return 1 - clamp(finiteOr(scrollingFriction, 4), 1, 100) / 2000;
}

export const momentumScrolling = definePatch<MomentumScrollingState>("momentumScrolling", {
  state: () => ({ scroller: null }),
  evaluate(ctx) {
    const value = finiteInput(ctx, "value");
    if (ctx.muted) {
      ctx.output("output", value);
      ctx.output("velocity", 0);
      ctx.output("moving", false);
      return;
    }
    const tracking = ctx.input<boolean>("tracking") === true;
    const startBoundary = finiteInput(ctx, "startBoundary");
    const endBoundary = finiteInput(ctx, "endBoundary");
    const lo = Math.min(startBoundary, endBoundary);
    const hi = Math.max(startBoundary, endBoundary);
    const stick = ctx.input<boolean>("stickToBoundaries") === true;
    const options: Partial<MomentumScrollerOptions> = {
      min: lo,
      max: hi,
      deceleration: scrollingDeceleration(ctx.input<number>("scrollingFriction")),
      momentum: true,
      stickToBoundaries: stick,
      rubberBandTension: Math.max(finiteOr(ctx.input("rubberBandTension"), 200), 10),
      rubberBandFriction: Math.max(finiteOr(ctx.input("rubberBandFriction"), 28), 10),
      pageSize: 0,
    };
    let scroller = ctx.state.scroller;
    if (!scroller) ctx.state.scroller = scroller = new MomentumScroller(options, value);
    else scroller.setOptions(options);

    const target = stick ? clamp(value, lo, hi) : value;
    if (tracking) {
      if (scroller.phase !== "tracking") {
        // Grabbing catches any motion; the first tracking frame takes no velocity sample.
        scroller.value = target;
        scroller.beginDrag();
      } else {
        scroller.track(target);
      }
    } else if (scroller.phase === "tracking") {
      if (stick && (scroller.value < lo || scroller.value > hi)) {
        scroller.value = clamp(scroller.value, lo, hi);
        scroller.stop();
      } else {
        scroller.release();
      }
    }
    scroller.step(ctx.dt);
    if (scroller.isAnimating) ctx.requestNextFrame();
    ctx.output("output", scroller.value);
    ctx.output("velocity", scroller.phase === "idle" ? 0 : scroller.velocity);
    ctx.output("moving", scroller.phase === "decelerating" || scroller.phase === "rubberBanding");
  },
  mutedBehavior: "evaluate",
});
