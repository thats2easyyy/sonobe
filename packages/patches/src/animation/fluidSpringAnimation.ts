/** Fluid Spring Animation: an Apple-style spring (Response, Damping Fraction) with gesture velocity handoff. */

import { definePatch, fluidSpringConfig, fromComponents, warnOnce } from "../infra/index.ts";
import { createGestureSpringState, finiteComponents, requireSpec, stepGestureSpring, variantOf } from "./shared.ts";
import type { GestureSpringState } from "./shared.ts";

const SPEC = requireSpec("fluidSpringAnimation");

export const fluidSpringAnimation = definePatch<GestureSpringState>("fluidSpringAnimation", {
  state: createGestureSpringState,
  evaluate(ctx) {
    const type = variantOf(ctx, SPEC);
    const target = finiteComponents(
      ctx,
      ctx.input("number"),
      type,
      ctx.state.spring?.target,
      "number",
      "Fluid Spring Animation got a Number that isn't finite, so it keeps animating toward its previous target.",
    );
    const response = ctx.input<number>("response");
    if (!(response > 0)) warnOnce(ctx, "response", "Fluid Spring Animation needs a Response above 0 seconds, so it uses 0.01 s.");
    const value = stepGestureSpring(ctx, ctx.state, {
      target,
      config: fluidSpringConfig(response, ctx.input<number>("dampingFraction")),
      active: ctx.input<boolean>("gestureActive") === true,
      gestureVelocity: () =>
        finiteComponents(
          ctx,
          ctx.input("gestureVelocity"),
          type,
          undefined,
          "gestureVelocity",
          "Fluid Spring Animation got a Gesture Velocity that isn't finite, so it uses 0 for that component.",
        ),
      tooStiffMessage: "Fluid Spring Animation's spring is too stiff to simulate, so it jumps straight to its target.",
    });
    ctx.output("output", fromComponents(value, type));
  },
});
