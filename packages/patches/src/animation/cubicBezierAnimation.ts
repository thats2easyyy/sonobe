/** Cubic Bezier Animation: tweens toward Number over Duration along a CSS cubic-bezier curve. */

import { definePatch, fromComponents, safeDuration, sameComponents } from "../infra/index.ts";
import { cubicBezierEase, finiteComponents, readBezierControls, requireSpec, variantOf, withMutedBehavior } from "./shared.ts";

const SPEC = requireSpec("cubicBezierAnimation");

export interface CubicBezierAnimationState {
  from: number[];
  to: number[];
  value: number[];
  /** Seconds since the animation in flight started. */
  elapsed: number;
  active: boolean;
  initialized: boolean;
}

export const cubicBezierAnimation = withMutedBehavior(
  definePatch<CubicBezierAnimationState>("cubicBezierAnimation", {
    state: () => ({ from: [], to: [], value: [], elapsed: 0, active: false, initialized: false }),
    evaluate(ctx) {
      const type = variantOf(ctx, SPEC);
      if (ctx.node.muted) {
        ctx.output("output", ctx.input("number"));
        ctx.output("curvePoint", [0, 0]);
        return;
      }
      const state = ctx.state;
      const target = finiteComponents(
        ctx,
        ctx.input("number"),
        type,
        state.initialized ? state.to : undefined,
        "number",
        "Cubic Bezier Animation got a Number that isn't finite, so it keeps animating toward its previous target.",
      );
      if (!state.initialized || state.to.length !== target.length) {
        state.from = [...target];
        state.to = [...target];
        state.value = [...target];
        state.elapsed = 0;
        state.active = false;
        state.initialized = true;
      } else if (!sameComponents(target, state.to)) {
        state.from = [...state.value];
        state.to = [...target];
        state.elapsed = 0;
        state.active = true;
      }
      const duration = safeDuration(ctx.input("duration")).seconds;
      let x = 1;
      if (state.active) {
        if (ctx.dt > 0) state.elapsed += ctx.dt;
        // Summed frame times drift (30 × 1/60 < 0.5), so finish within a nanosecond of Duration.
        x = duration === 0 || state.elapsed >= duration - 1e-9 ? 1 : state.elapsed / duration;
        if (x === 1) state.active = false;
      }
      const [x1, y1, x2, y2] = readBezierControls(ctx, "Cubic Bezier Animation");
      const eased = cubicBezierEase(x1, y1, x2, y2, x);
      const y = Number.isFinite(eased) ? eased : 1;
      for (let i = 0; i < state.to.length; i++) {
        const a = state.from[i]!;
        const b = state.to[i]!;
        const v = x === 1 ? b : a + (b - a) * y;
        state.value[i] = Number.isFinite(v) ? v : b;
      }
      if (state.active) ctx.requestNextFrame();
      ctx.output("output", fromComponents(state.value, type));
      ctx.output("curvePoint", [x, y]);
    },
  }),
  // Muted, Output passes Number through and Curve Point is zero (the static point output has no matching input).
  "evaluate",
);
