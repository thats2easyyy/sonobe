/** Drag: turns presses on a layer into a parent-space position, with bounds, axis lock, and momentum. */

import { decayPosition, decayTimeToReach, decayVelocity } from "@sonobe/engine";
import { clamp, definePatch, finiteOr } from "../infra/index.ts";
import { ancestorScale, finitePointInput, layerInput, withMutedBehavior, type Vec2 } from "./shared.ts";

interface DragState {
  position: Vec2;
  velocity: Vec2;
  dragging: boolean;
  coasting: boolean;
  /** Dragged since the last restart or Reset; until then Position follows Start Position live. */
  touched: boolean;
  grab: Vec2;
  ignoreUntilRelease: boolean;
  initialized: boolean;
}

/** Coasting stops below this speed, in points per second. */
const REST_SPEED = 0.25;
const MAX_DT = 0.064;

/** Momentum Friction → velocity kept per millisecond: 50 → 0.998 (normal), 250 → 0.99 (fast). */
export function dragDeceleration(momentumFriction: number): number {
  return 1 - Math.max(finiteOr(momentumFriction, 50), 1) / 25000;
}

interface Bounds {
  lo: Vec2;
  hi: Vec2;
}

/** POP decay per axis; with bounds, an axis that reaches a bound stops there with no bounce. */
function coast(state: DragState, dt: number, deceleration: number, bounds: Bounds | null): void {
  const h = Math.min(Math.max(dt, 0), MAX_DT);
  const position: Vec2 = [state.position[0], state.position[1]];
  const velocity: Vec2 = [state.velocity[0], state.velocity[1]];
  for (const a of [0, 1] as const) {
    if (velocity[a] === 0) continue;
    if (bounds) {
      const bound = velocity[a] > 0 ? bounds.hi[a] : bounds.lo[a];
      const hit = decayTimeToReach(position[a], velocity[a], deceleration, bound);
      if (hit !== null && hit <= h) {
        position[a] = bound;
        velocity[a] = 0;
        continue;
      }
    }
    position[a] = decayPosition(position[a], velocity[a], deceleration, h);
    velocity[a] = decayVelocity(velocity[a], deceleration, h);
    if (bounds) {
      const limited = clamp(position[a], bounds.lo[a], bounds.hi[a]);
      if (limited !== position[a]) velocity[a] = 0;
      position[a] = limited;
    }
  }
  state.position = position;
  state.velocity = velocity;
  if (!(Math.hypot(velocity[0], velocity[1]) >= REST_SPEED)) {
    state.velocity = [0, 0];
    state.coasting = false;
  }
}

export const drag = withMutedBehavior(
  definePatch<DragState>("drag", {
    state: () => ({
      position: [0, 0],
      velocity: [0, 0],
      dragging: false,
      coasting: false,
      touched: false,
      grab: [0, 0],
      ignoreUntilRelease: false,
      initialized: false,
    }),
    evaluate(ctx) {
      const state = ctx.state;
      const start = finitePointInput(ctx, "startPosition");
      if (ctx.node.muted) {
        ctx.output("position", start);
        ctx.output("dragging", false);
        ctx.output("velocity", [0, 0]);
        return;
      }
      const enabled = ctx.input<boolean>("enabled") === true;
      const clip = ctx.input<boolean>("clip") === true;
      const min = finitePointInput(ctx, "min");
      const max = finitePointInput(ctx, "max");
      const bounds: Bounds = {
        lo: [Math.min(min[0], max[0]), Math.min(min[1], max[1])],
        hi: [Math.max(min[0], max[0]), Math.max(min[1], max[1])],
      };
      const limit = (p: Vec2): Vec2 => (clip ? [clamp(p[0], bounds.lo[0], bounds.hi[0]), clamp(p[1], bounds.lo[1], bounds.hi[1])] : [p[0], p[1]]);
      const axis = ctx.input<string>("axis");
      const mask: Vec2 = axis === "horizontal" ? [1, 0] : axis === "vertical" ? [0, 1] : [1, 1];
      const ref = layerInput(ctx);
      const p = ctx.services.pointer(ref);
      if (!state.initialized) {
        state.position = limit(start);
        state.initialized = true;
      }

      if (ctx.pulsed("reset")) {
        state.position = limit(start);
        state.velocity = [0, 0];
        state.dragging = false;
        state.coasting = false;
        state.touched = false;
        state.ignoreUntilRelease = p.down;
      } else if (!enabled) {
        if (state.dragging) state.ignoreUntilRelease = p.down;
        state.dragging = false;
        state.coasting = false;
        state.velocity = [0, 0];
      } else {
        if (!state.touched) state.position = limit(start);
        if (!state.dragging && p.began && !state.ignoreUntilRelease) {
          state.dragging = true;
          state.coasting = false;
          state.touched = true;
          state.grab = state.position; // catches a coasting layer
        }
        if (state.dragging) {
          const scale = ancestorScale(ctx.services, ref);
          const t: Vec2 = [finiteOr(p.translation[0], 0) / scale[0], finiteOr(p.translation[1], 0) / scale[1]];
          state.position = limit([state.grab[0] + t[0] * mask[0], state.grab[1] + t[1] * mask[1]]);
          const v: Vec2 = [finiteOr(p.velocity[0], 0) / scale[0], finiteOr(p.velocity[1], 0) / scale[1]];
          state.velocity = [v[0] * mask[0], v[1] * mask[1]];
          if (p.ended || !p.down) {
            state.dragging = false;
            if (p.ended && ctx.input<boolean>("momentum") === true && Math.hypot(state.velocity[0], state.velocity[1]) > REST_SPEED) state.coasting = true;
            else state.velocity = [0, 0];
          }
          if (state.dragging || state.coasting) ctx.requestNextFrame();
        } else if (state.coasting) {
          coast(state, ctx.dt, dragDeceleration(ctx.input<number>("momentumFriction")), clip ? bounds : null);
          if (state.coasting) ctx.requestNextFrame();
        } else if (state.touched) {
          state.position = limit(state.position); // Clip, Min, or Max changed
        }
      }
      if (!p.down) state.ignoreUntilRelease = false;
      ctx.output("position", state.position);
      ctx.output("dragging", state.dragging);
      ctx.output("velocity", state.velocity);
    },
  }),
  "evaluate",
);
