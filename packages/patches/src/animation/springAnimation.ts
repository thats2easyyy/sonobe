/** Spring Animation: a physical spring (mass, tension k, friction c) with gesture velocity handoff. */

import { componentCount, definePatch, fromComponents } from "../infra/index.ts";
import { createGestureSpringState, finiteComponents, finiteInput, requireSpec, stepGestureSpring, variantOf } from "./shared.ts";
import type { GestureSpringState } from "./shared.ts";

const SPEC = requireSpec("springAnimation");

/** Smallest mass the spring accepts. */
export const MIN_SPRING_MASS = 0.01;
const DEFAULT_MASS = 1;
const DEFAULT_TENSION = 130.51;
const DEFAULT_FRICTION = 18.85;

export const springAnimation = definePatch<GestureSpringState>("springAnimation", {
  state: createGestureSpringState,
  evaluate(ctx) {
    const type = variantOf(ctx, SPEC);
    const target = finiteComponents(
      ctx,
      ctx.input("number"),
      type,
      ctx.state.spring?.target,
      "number",
      "Spring Animation got a Number that isn't finite, so it keeps animating toward its previous target.",
    );
    const mass = finiteInput(ctx, "mass", DEFAULT_MASS, `Spring Animation: Mass isn't a finite number, so it uses ${DEFAULT_MASS}.`);
    const tension = finiteInput(ctx, "tension", DEFAULT_TENSION, `Spring Animation: Tension isn't a finite number, so it uses ${DEFAULT_TENSION}.`);
    const friction = finiteInput(ctx, "friction", DEFAULT_FRICTION, `Spring Animation: Friction isn't a finite number, so it uses ${DEFAULT_FRICTION}.`);
    const value = stepGestureSpring(ctx, ctx.state, {
      target,
      config: { mass: Math.max(MIN_SPRING_MASS, mass), stiffness: Math.max(0, tension), damping: Math.max(0, friction) },
      active: ctx.input<boolean>("gestureActive") === true,
      gestureVelocity: () =>
        finiteComponents(
          ctx,
          ctx.input("gestureVelocity"),
          type,
          undefined,
          "gestureVelocity",
          "Spring Animation got a Gesture Velocity that isn't finite, so it uses 0 for that component.",
        ),
      tooStiffMessage: "Spring Animation's spring is too stiff or heavily damped to simulate, so it jumps straight to its target.",
    });
    ctx.output("output", fromComponents(value, type));
  },
});
