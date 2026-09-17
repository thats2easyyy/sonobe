/**
 * Vibrate: buzzes for Duration seconds (0–10) on each pulse through the host's vibration API, or
 * logs where there's no motor. Reports whether vibration is available.
 */

import { definePatch, toNumber } from "../infra/index.ts";

interface VibrateState {
  /** This instance started a buzz, so dispose stops it. */
  buzzed: boolean;
}

/** Duration in seconds as whole milliseconds clamped to 0–10 s; non-finite reads 0. */
export function vibrationMs(seconds: unknown): number {
  const v = typeof seconds === "number" && Number.isFinite(seconds) ? seconds : 0;
  return Math.round(Math.min(Math.max(v, 0), 10) * 1000);
}

export const vibratePatch = definePatch<VibrateState>("vibrate", {
  state: () => ({ buzzed: false }),
  evaluate(ctx) {
    const vibrate = ctx.services.platform.vibrate;
    ctx.output("available", typeof vibrate === "function");
    if (!ctx.pulsed("vibrate")) return;
    const ms = vibrationMs(toNumber(ctx.input("duration"), Number.NaN));
    if (ms <= 0) return;
    if (typeof vibrate === "function") {
      vibrate(ms);
      ctx.state.buzzed = true;
    } else {
      ctx.services.log("log", `Vibrate: ${ms} ms (this device can't vibrate)`);
    }
  },
  dispose(state, services) {
    if (state?.buzzed) services.platform.vibrate?.(0);
  },
});
