/** Tap Toggle: Interaction and Switch in one patch; each tap on the layer flips the state. */

import { definePatch } from "../infra/index.ts";
import { layerInput } from "./shared.ts";

interface TapToggleState {
  on: boolean;
  blocked: boolean;
  /** Start On is read once, when the state for this index is created. */
  initialized: boolean;
}

export const tapToggle = definePatch<TapToggleState>("tapToggle", {
  state: () => ({ on: false, blocked: false, initialized: false }),
  evaluate(ctx) {
    const state = ctx.state;
    if (!state.initialized) {
      state.on = ctx.input<boolean>("startOn") === true;
      state.initialized = true;
    }
    if (ctx.muted) {
      ctx.output("on", ctx.input<boolean>("startOn") === true);
      ctx.output("down", false);
      return;
    }
    const snap = ctx.services.pointer(layerInput(ctx));
    const enabled = ctx.input<boolean>("enabled") === true;
    if (!enabled && (snap.down || snap.ended)) state.blocked = true;
    const live = enabled && !state.blocked;
    const before = state.on;
    if (ctx.pulsed("turnOff")) state.on = false;
    else if (ctx.pulsed("turnOn")) state.on = true;
    else if ((live && snap.tapped) || ctx.pulsed("flip")) state.on = !state.on;
    ctx.output("on", state.on);
    ctx.output("down", live && snap.down);
    if (state.on && !before) ctx.pulse("turnedOn");
    if (!state.on && before) ctx.pulse("turnedOff");
    if (!snap.down) state.blocked = false;
  },
  mutedBehavior: "evaluate",
});
