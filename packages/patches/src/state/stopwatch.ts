/**
 * Stopwatch: counts running seconds. Time accrues between frames while running, Reset zeroes it without
 * starting or stopping, and Stop beats Start in the same frame.
 */

import { definePatch } from "../infra/index.ts";

export interface StopwatchState {
  running: boolean;
  elapsed: number;
}

export const stopwatchPatch = definePatch<StopwatchState>("stopwatch", {
  state: () => ({ running: false, elapsed: 0 }),
  evaluate(ctx) {
    const s = ctx.state;
    if (s.running && ctx.dt > 0) s.elapsed += ctx.dt;
    if (ctx.pulsed("reset")) s.elapsed = 0;
    if (ctx.pulsed("stop")) s.running = false;
    else if (ctx.pulsed("start")) s.running = true;
    if (s.running) ctx.requestNextFrame();
    ctx.output("time", s.elapsed);
    ctx.output("running", s.running);
  },
});
