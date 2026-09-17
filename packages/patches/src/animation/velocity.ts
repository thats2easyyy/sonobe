/** Velocity: how fast Value changes, in units per second, seeded on the first frame so there's no spike. */

import { allFinite, components, definePatch, fromComponents, warnOnce, zeros } from "../infra/index.ts";
import { requireSpec, variantOf, withMutedBehavior } from "./shared.ts";

const SPEC = requireSpec("velocity");

export interface VelocityState {
  previous: number[] | null;
  velocity: number[];
}

export const velocity = withMutedBehavior(
  definePatch<VelocityState>("velocity", {
    state: () => ({ previous: null, velocity: [] }),
    evaluate(ctx) {
      const type = variantOf(ctx, SPEC);
      const state = ctx.state;
      const value = components(ctx.input("value"), type);
      if (!allFinite(value)) {
        warnOnce(ctx, "value", "Velocity got a Value that isn't finite, so it outputs 0.");
        ctx.output("velocity", fromComponents(zeros(value.length), type));
        return;
      }
      if (state.previous === null || state.previous.length !== value.length) {
        state.previous = value;
        state.velocity = zeros(value.length);
      } else if (ctx.dt > 0) {
        const previous = state.previous;
        state.velocity = value.map((n, i) => {
          const speed = (n - previous[i]!) / ctx.dt;
          if (Number.isFinite(speed)) return speed;
          warnOnce(ctx, "overflow", "Velocity measured a speed too large to represent, so it outputs 0.");
          return 0;
        });
        state.previous = value;
      }
      ctx.output("velocity", fromComponents(state.velocity, type));
    },
  }),
  // A muted Velocity outputs 0 rather than passing a position through as a speed.
  "zero",
);
