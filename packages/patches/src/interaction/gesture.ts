/** Gesture: Interaction plus translation, velocity, and start position during a press. */

import { definePatch } from "../infra/index.ts";
import { layerInput, withMutedBehavior, type Vec2 } from "./shared.ts";

interface GestureState {
  lastPosition: Vec2;
  lastLocal: Vec2;
  lastStart: Vec2;
  blocked: boolean;
}

export const gesture = withMutedBehavior(
  definePatch<GestureState>("gesture", {
    state: () => ({ lastPosition: [0, 0], lastLocal: [0, 0], lastStart: [0, 0], blocked: false }),
    evaluate(ctx) {
      const state = ctx.state;
      const snap = ctx.services.pointer(layerInput(ctx));
      const enabled = ctx.input<boolean>("enabled") === true;
      if (!enabled && (snap.down || snap.ended)) state.blocked = true;
      const live = enabled && !state.blocked;
      // Pressed now, or released this frame: translation and velocity keep their final values.
      const active = live && (snap.down || snap.ended);
      if (active) {
        state.lastPosition = [snap.position[0], snap.position[1]];
        state.lastLocal = [snap.localPosition[0], snap.localPosition[1]];
        state.lastStart = [snap.startPosition[0], snap.startPosition[1]];
      }
      ctx.output("down", live && snap.down);
      if (live && snap.tapped) ctx.pulse("tap");
      ctx.output("position", state.lastPosition);
      ctx.output("translation", active ? [snap.translation[0], snap.translation[1]] : [0, 0]);
      ctx.output("velocity", active ? [snap.velocity[0], snap.velocity[1]] : [0, 0]);
      ctx.output("startPosition", state.lastStart);
      ctx.output("localPosition", state.lastLocal);
      if (!snap.down) state.blocked = false;
    },
  }),
  "zero",
);
