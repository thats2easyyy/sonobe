/**
 * Restart Prototype: requests a full restart on a pulse. The runtime finishes the current frame and
 * restarts before the next step. Pulses on the first frame are ignored so launch can't loop forever.
 */

import { definePatch } from "../infra/index.ts";

export interface RestartPrototypeState {
  /** This index already warned about a first-frame pulse (state resets with every restart). */
  warned: boolean;
}

export const restartPrototype = definePatch<RestartPrototypeState>("restartPrototype", {
  state: () => ({ warned: false }),
  evaluate(ctx) {
    if (!ctx.pulsed("restart")) return;
    if (ctx.frame === 0) {
      if (!ctx.state.warned) {
        ctx.state.warned = true;
        ctx.services.log("warn", `${ctx.id} ignored a restart pulse on the first frame; restarting there would repeat forever`);
      }
      return;
    }
    ctx.services.restart();
  },
});
