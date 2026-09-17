/** Classic Animation: tweens toward Number over Duration with an easing curve; a new target restarts from the current value. */

import { createTweenState, jumpTween, retargetTween, stepTween } from "@sonobe/engine";
import type { TweenState } from "@sonobe/engine";
import { curveOrLinear, definePatch, fromComponents, safeDuration } from "../infra/index.ts";
import { finiteComponents, requireSpec, variantOf } from "./shared.ts";

const SPEC = requireSpec("classicAnimation");

export interface ClassicAnimationState {
  tween: TweenState | null;
}

export const classicAnimation = definePatch<ClassicAnimationState>("classicAnimation", {
  state: () => ({ tween: null }),
  evaluate(ctx) {
    const type = variantOf(ctx, SPEC);
    const previous = ctx.state.tween;
    const target = finiteComponents(
      ctx,
      ctx.input("number"),
      type,
      previous?.to,
      "number",
      "Classic Animation got a Number that isn't finite, so it keeps animating toward its previous target.",
    );
    let tween: TweenState;
    if (previous === null || previous.to.length !== target.length) {
      tween = ctx.state.tween = createTweenState(target);
    } else {
      tween = previous;
      retargetTween(tween, target);
    }
    const duration = safeDuration(ctx.input("duration")).seconds;
    let done = stepTween(tween, ctx.dt, duration, curveOrLinear(String(ctx.input("curve") ?? "")));
    // Summed frame times drift (24 × 1/60 < 0.4), so finish within a nanosecond of Duration.
    if (!done && tween.elapsed >= duration - 1e-9) {
      jumpTween(tween, tween.to);
      done = true;
    }
    if (!done) ctx.requestNextFrame();
    ctx.output("output", fromComponents(tween.value, type));
  },
});
