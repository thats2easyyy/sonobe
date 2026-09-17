/** Smooth Value: exponential smoothing toward Value with separate rising and falling hysteresis, frame-rate compensated. */

import { clamp01, definePatch, finiteOr, warnOnce } from "../infra/index.ts";

export interface SmoothValueState {
  current: number | null;
}

export const smoothValue = definePatch<SmoothValueState>("smoothValue", {
  state: () => ({ current: null }),
  evaluate(ctx) {
    const state = ctx.state;
    const v = ctx.input<number>("value");
    if (!Number.isFinite(v)) {
      warnOnce(ctx, "value", "Smooth Value got a Value that isn't finite, so it holds its previous output.");
      ctx.output("output", state.current ?? 0);
      return;
    }
    if (state.current === null || ctx.pulsed("reset")) {
      state.current = v;
    } else if (ctx.dt > 0) {
      const rising = clamp01(finiteOr(ctx.input("risingHysteresis"), 0));
      const fallingRaw = ctx.input<number>("fallingHysteresis");
      const falling = !Number.isFinite(fallingRaw) || fallingRaw < 0 ? rising : clamp01(fallingRaw);
      const h = v > state.current ? rising : falling;
      const effective = Math.pow(h, ctx.dt * 60);
      state.current = state.current * effective + v * (1 - effective);
      if (Math.abs(v - state.current) <= 1e-6 * Math.max(1, Math.abs(v))) state.current = v;
    }
    if (state.current !== v) ctx.requestNextFrame();
    ctx.output("output", state.current);
  },
});
