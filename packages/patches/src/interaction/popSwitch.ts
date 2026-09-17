/** Pop Switch: a two-state switch driven by a swipe or pulses, springing to Start or End. */

import { DECELERATION_FAST, createSpringState, decayFinalPosition, rubberBandClamp, stepSpring } from "@sonobe/engine";
import type { SpringState } from "@sonobe/engine";
import { definePatch, finiteOr, popSpringConfig, warnOnce } from "../infra/index.ts";
import { ancestorScale, finiteInput, layerInput, withMutedBehavior } from "./shared.ts";

interface PopSwitchState {
  on: boolean;
  spring: SpringState;
  dragging: boolean;
  grab: number;
  ignoreUntilRelease: boolean;
  initialized: boolean;
}

/** Drag resistance past Start or End. */
const RUBBER_BAND_RESISTANCE = 0.55;

export const popSwitch = withMutedBehavior(
  definePatch<PopSwitchState>("popSwitch", {
    state: () => ({ on: false, spring: createSpringState(0), dragging: false, grab: 0, ignoreUntilRelease: false, initialized: false }),
    evaluate(ctx) {
      const state = ctx.state;
      const start = finiteInput(ctx, "start");
      const end = finiteInput(ctx, "end");
      if (ctx.node.muted) {
        ctx.output("output", start);
        ctx.output("progress", 0);
        ctx.output("on", false);
        ctx.output("dragging", false);
        return;
      }
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      const span = Math.max(hi - lo, 1);
      const config = popSpringConfig(finiteInput(ctx, "bounciness"), Math.max(finiteInput(ctx, "speed"), 0));
      if (!state.initialized) {
        state.spring = createSpringState(start);
        state.initialized = true;
      }
      const spring = state.spring;
      const ref = layerInput(ctx);
      const p = ctx.services.pointer(ref);

      const cancelDrag = () => {
        if (!state.dragging) return;
        state.dragging = false; // the spring keeps the tracked velocity
        state.ignoreUntilRelease = p.down;
      };
      const release = () => {
        const projected = spring.value + decayFinalPosition(0, spring.velocity, DECELERATION_FAST);
        const toEnd = Math.abs(projected - end);
        const toStart = Math.abs(projected - start);
        if (toEnd < toStart) state.on = true;
        else if (toStart < toEnd) state.on = false;
        state.dragging = false;
      };

      // 1. Pulses. Precedence: turnOff > turnOn > flip.
      if (ctx.pulsed("turnOff")) {
        if (state.on) {
          state.on = false;
          cancelDrag();
        }
      } else if (ctx.pulsed("turnOn")) {
        if (!state.on) {
          state.on = true;
          cancelDrag();
        }
      } else if (ctx.pulsed("flip")) {
        state.on = !state.on;
        cancelDrag();
      }

      // 2. Gesture. Pinches need every finger's position, which the pointer snapshot doesn't expose yet.
      const gesture = ctx.input<string>("gesture");
      const axis: 0 | 1 | null = gesture === "swipeX" ? 0 : gesture === "swipeY" ? 1 : null;
      if (gesture !== "none" && axis === null) {
        warnOnce(ctx, "pinch", "Pop Switch's pinch gestures need multi-touch tracking that Sonobe doesn't have yet, so only the pulses move this switch.");
      }
      const enabled = ctx.input<boolean>("enabled") === true;
      if (enabled && axis !== null && !state.ignoreUntilRelease) {
        if (!state.dragging && p.began) {
          state.dragging = true;
          state.grab = spring.value;
          spring.velocity = 0;
        }
        if (state.dragging && (p.down || p.ended)) {
          const scale = ancestorScale(ctx.services, ref)[axis];
          const raw = state.grab + finiteOr(p.translation[axis], 0) / scale;
          spring.value = rubberBandClamp(raw, lo, hi, span, RUBBER_BAND_RESISTANCE);
          spring.velocity = finiteOr(p.velocity[axis], 0) / scale;
        }
        if (state.dragging && !p.down) release();
      } else if (state.dragging) {
        release(); // disabled or no swipe gesture mid-drag: release as if the fingers lifted
      }
      if (!p.down) state.ignoreUntilRelease = false;

      // 3. Animate toward the committed state.
      spring.target = state.on ? end : start;
      if (state.dragging) ctx.requestNextFrame();
      else if (!stepSpring(spring, config, ctx.dt)) ctx.requestNextFrame();

      const progress = end !== start ? (spring.value - start) / (end - start) : spring.value >= start ? 1 : 0;
      ctx.output("output", spring.value);
      ctx.output("progress", Number.isFinite(progress) ? progress : 0);
      ctx.output("on", state.on);
      ctx.output("dragging", state.dragging);
    },
  }),
  "evaluate",
);
