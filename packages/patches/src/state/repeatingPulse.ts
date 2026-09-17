/**
 * Repeating Pulse: a metronome that ticks every Interval seconds, first one interval after it starts.
 * Disabled, it pauses mid-interval; Reset restarts the countdown.
 */

import { createIntervalState, definePatch, stepInterval, toBool } from "../infra/index.ts";
import type { IntervalState } from "../infra/index.ts";
import { readDuration } from "./shared.ts";

export const repeatingPulsePatch = definePatch<IntervalState>("repeatingPulse", {
  state: createIntervalState,
  evaluate(ctx) {
    const interval = readDuration(ctx, "interval", "Repeating Pulse");
    const enabled = toBool(ctx.input("enabled"));
    if (stepInterval(ctx.state, { dt: ctx.dt, interval, enabled, reset: ctx.pulsed("reset") })) ctx.pulse("tick");
    if (enabled) ctx.requestNextFrame();
  },
});
