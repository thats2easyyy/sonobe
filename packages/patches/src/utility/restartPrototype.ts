/**
 * Restart Prototype: requests a full restart on a pulse. The runtime finishes the current frame and
 * restarts before the next step. Pulses on the first frame are ignored so launch can't loop forever.
 */

import { definePatch } from "../infra/index.ts";

export const restartPrototype = definePatch("restartPrototype", {
  evaluate(ctx) {
    if (!ctx.pulsed("restart")) return;
    if (ctx.frame === 0) {
      // The engine's once-ledger resets with every restart, so the warning returns after each one.
      ctx.warnOnce("firstFrame", `${ctx.id} ignored a restart pulse on the first frame; restarting there would repeat forever`);
      return;
    }
    ctx.services.restart();
  },
});
