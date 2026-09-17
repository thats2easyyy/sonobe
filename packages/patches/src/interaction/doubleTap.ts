/** Double Tap: tells a double tap from a single tap by waiting Interval after each tap. */

import { definePatch, finiteOr } from "../infra/index.ts";
import { layerInput } from "./shared.ts";

interface DoubleTapState {
  pending: boolean;
  firstTapTime: number;
}

export const doubleTap = definePatch<DoubleTapState>("doubleTap", {
  state: () => ({ pending: false, firstTapTime: 0 }),
  evaluate(ctx) {
    const state = ctx.state;
    const enabled = ctx.input<boolean>("enabled") === true;
    const interval = Math.max(0, finiteOr(ctx.input("interval"), 0));
    const tapped = ctx.isConnected("tap") ? ctx.pulsed("tap") : ctx.services.pointer(layerInput(ctx)).tapped;
    if (!enabled) {
      state.pending = false; // a waiting tap is discarded
      return;
    }
    const t = ctx.time;
    if (tapped && state.pending && t - state.firstTapTime <= interval + 1e-9) {
      state.pending = false;
      ctx.pulse("doubleTap");
    } else {
      if (state.pending && t - state.firstTapTime >= interval - 1e-9) {
        state.pending = false;
        ctx.pulse("singleTap"); // the lone tap's wait is over
      }
      if (tapped) {
        if (interval === 0) ctx.pulse("singleTap");
        else {
          state.pending = true;
          state.firstTapTime = t;
        }
      }
    }
    if (state.pending) ctx.requestNextFrame();
  },
  mutedBehavior: "zero",
});
