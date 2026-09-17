/** Long Press: turns on once a press is held still for a duration; taps on early release. */

import { definePatch, finiteOr } from "../infra/index.ts";
import { TOUCH_SLOP, layerInput, samePoint, type Vec2 } from "./shared.ts";

interface LongPressState {
  pressing: boolean;
  recognized: boolean;
  moved: boolean;
  startTime: number;
  start: Vec2;
  /** A press overlapped a disabled frame; ignored until it lifts. */
  blocked: boolean;
}

export const longPress = definePatch<LongPressState>("longPress", {
  state: () => ({ pressing: false, recognized: false, moved: false, startTime: 0, start: [0, 0], blocked: false }),
  evaluate(ctx) {
    const state = ctx.state;
    const enabled = ctx.input<boolean>("enabled") === true;
    const duration = Math.max(0, finiteOr(ctx.input("duration"), 0));
    const snap = ctx.isConnected("down") ? null : ctx.services.pointer(layerInput(ctx));
    const down = snap ? snap.down : ctx.input<boolean>("down") === true;

    if (!enabled || state.blocked) {
      state.blocked = down;
      state.pressing = false;
      state.recognized = false;
      ctx.output("longPress", false);
      ctx.output("progress", 0);
      return;
    }
    // A new press: Down rose, or another finger took over the pointer snapshot.
    if (down && (!state.pressing || (snap !== null && !samePoint(snap.startPosition, state.start)))) {
      state.pressing = true;
      state.recognized = false;
      state.moved = false;
      state.startTime = ctx.time;
      state.start = snap ? [snap.startPosition[0], snap.startPosition[1]] : [0, 0];
    }
    let progress = 0;
    if (down) {
      if (snap && !state.recognized && Math.hypot(snap.translation[0], snap.translation[1]) >= TOUCH_SLOP) state.moved = true;
      const held = ctx.time - state.startTime;
      if (!state.recognized && !state.moved && held >= duration - 1e-9) state.recognized = true;
      progress = state.recognized ? 1 : state.moved ? 0 : Math.min(1, held / duration);
      if (!state.recognized && !state.moved) ctx.requestNextFrame();
    } else if (state.pressing) {
      if (!state.recognized && (snap ? snap.tapped : true)) ctx.pulse("tap");
      state.pressing = false;
      state.recognized = false;
    }
    ctx.output("longPress", down && state.recognized);
    ctx.output("progress", progress);
  },
  mutedBehavior: "zero",
});
