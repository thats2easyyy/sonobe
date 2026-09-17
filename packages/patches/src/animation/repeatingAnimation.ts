/** Repeating Animation: progress that cycles 0 → 1 over Duration, mirrored or sawtooth, with easing. */

import { clamp01, curveOrLinear, definePatch, finiteOr, positiveMod, warnOnce } from "../infra/index.ts";

export interface RepeatingAnimationState {
  /** Position in the cycle, in trips, kept in [0, 2). */
  phase: number;
}

export const repeatingAnimation = definePatch<RepeatingAnimationState>("repeatingAnimation", {
  state: () => ({ phase: 0 }),
  evaluate(ctx) {
    const state = ctx.state;
    const duration = ctx.input<number>("duration");
    const valid = Number.isFinite(duration) && duration > 0;
    const enabled = ctx.input<boolean>("enabled") === true;
    if (ctx.frame > 0 && enabled && valid && ctx.dt > 0) state.phase = positiveMod(state.phase + ctx.dt / duration, 2);
    if (ctx.pulsed("reset")) state.phase = 0;
    if (!valid) {
      warnOnce(ctx, "duration", "Repeating Animation needs a Duration above 0 seconds, so it holds at the start.");
      ctx.output("progress", 0);
      return;
    }
    if (enabled) ctx.requestNextFrame();
    const ease = curveOrLinear(String(ctx.input("curve") ?? ""));
    const u = state.phase + finiteOr(ctx.input("timeOffset"), 0) / duration;
    let leg: number;
    if (ctx.input<boolean>("mirrored")) {
      const w = positiveMod(u, 2);
      leg = w <= 1 ? w : 2 - w;
    } else {
      leg = positiveMod(u, 1);
    }
    ctx.output("progress", clamp01(ease(leg)));
  },
  // Muted Repeating Animation outputs 0 instead of passing Duration through as progress.
  mutedBehavior: "zero",
});
