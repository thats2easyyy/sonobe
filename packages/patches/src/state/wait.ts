/**
 * Wait: a one-shot timer. Start (re)starts it, Reset stops it (Reset wins), Done latches on completion,
 * Progress runs 0 → 1, and Finished pulses on the completing frame. Muted, it outputs idle values.
 */

import { definePatch } from "../infra/index.ts";
import { readDuration, withMutedBehavior } from "./shared.ts";

export interface WaitState {
  running: boolean;
  elapsed: number;
  done: boolean;
}

export const waitPatch = withMutedBehavior(
  definePatch<WaitState>("wait", {
    state: () => ({ running: false, elapsed: 0, done: false }),
    evaluate(ctx) {
      const s = ctx.state;
      const d = readDuration(ctx, "duration", "Wait");
      let finished = false;
      if (ctx.pulsed("reset")) {
        s.running = false;
        s.elapsed = 0;
        s.done = false;
      } else if (ctx.pulsed("start")) {
        s.running = true;
        s.elapsed = 0;
        s.done = false;
      } else if (s.running) {
        s.elapsed += ctx.dt > 0 ? ctx.dt : 0;
      }
      if (s.running && s.elapsed >= d - 1e-6) {
        s.running = false;
        s.done = true;
        finished = true;
      }
      if (s.running) ctx.requestNextFrame();
      ctx.output("done", s.done);
      ctx.output("progress", s.done ? 1 : d > 0 ? Math.min(s.elapsed / d, 1) : 0);
      if (finished) ctx.pulse("finished");
    },
  }),
  "zero",
);
