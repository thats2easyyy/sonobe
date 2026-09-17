/** Pop Animation: springs toward Number with Bounciness and Speed (Rebound BouncyConversion, RK4 at 1 ms). */

import { stepVectorSpring } from "@sonobe/engine";
import type { VectorSpringState } from "@sonobe/engine";
import { definePatch, fromComponents, popSpringConfig, trackSpringTarget } from "../infra/index.ts";
import { finiteComponents, requireSpec, variantOf } from "./shared.ts";

const SPEC = requireSpec("popAnimation");

export interface PopAnimationState {
  spring: VectorSpringState | null;
}

export const popAnimation = definePatch<PopAnimationState>("popAnimation", {
  state: () => ({ spring: null }),
  evaluate(ctx) {
    const type = variantOf(ctx, SPEC);
    const target = finiteComponents(
      ctx,
      ctx.input("number"),
      type,
      ctx.state.spring?.target,
      "number",
      "Pop Animation got a Number that isn't finite, so it keeps animating toward its previous target.",
    );
    const spring = (ctx.state.spring = trackSpringTarget(ctx.state.spring, target));
    const config = popSpringConfig(ctx.input<number>("bounciness"), ctx.input<number>("speed"));
    if (!stepVectorSpring(spring, config, ctx.dt)) ctx.requestNextFrame();
    ctx.output("output", fromComponents(spring.value, type));
  },
});
