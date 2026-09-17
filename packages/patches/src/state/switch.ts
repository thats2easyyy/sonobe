/** Switch: an on/off memory changed by pulses. Same-frame precedence: Turn Off > Turn On > Flip. */

import { definePatch, firstPulsed } from "../infra/index.ts";

export interface SwitchState {
  on: boolean;
}

const PRECEDENCE = ["turnOff", "turnOn", "flip"] as const;

export const switchPatch = definePatch<SwitchState>("switch", {
  state: () => ({ on: false }),
  evaluate(ctx) {
    const pulsed = firstPulsed(ctx, PRECEDENCE);
    if (pulsed === "turnOff") ctx.state.on = false;
    else if (pulsed === "turnOn") ctx.state.on = true;
    else if (pulsed === "flip") ctx.state.on = !ctx.state.on;
    ctx.output("on", ctx.state.on);
  },
});
