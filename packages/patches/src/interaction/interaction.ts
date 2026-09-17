/** Interaction: presses, taps, and pointer position on a layer or the whole screen. */

import { clamp01, definePatch } from "../infra/index.ts";
import { layerInput, type Vec2 } from "./shared.ts";

interface InteractionState {
  lastPosition: Vec2;
  lastLocal: Vec2;
  /** A press overlapped a disabled frame; ignore it until every pointer lifts. */
  blocked: boolean;
}

export const interaction = definePatch<InteractionState>("interaction", {
  state: () => ({ lastPosition: [0, 0], lastLocal: [0, 0], blocked: false }),
  evaluate(ctx) {
    const state = ctx.state;
    const snap = ctx.services.pointer(layerInput(ctx));
    const enabled = ctx.input<boolean>("enabled") === true;
    if (!enabled && (snap.down || snap.ended)) state.blocked = true;
    const live = enabled && !state.blocked;
    if (live && (snap.down || snap.ended)) {
      state.lastPosition = [snap.position[0], snap.position[1]];
      state.lastLocal = [snap.localPosition[0], snap.localPosition[1]];
    }
    ctx.output("down", live && snap.down);
    if (live && snap.tapped) ctx.pulse("tap");
    ctx.output("position", state.lastPosition);
    ctx.output("localPosition", state.lastLocal);
    ctx.output("force", live && snap.down && Number.isFinite(snap.pressure) ? clamp01(snap.pressure) : 0);
    if (!snap.down) state.blocked = false;
  },
  mutedBehavior: "zero",
});
