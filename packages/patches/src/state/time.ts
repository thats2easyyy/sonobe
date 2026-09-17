/** Time: the prototype clock in seconds and frames. Disabled, the outputs hold; muted, they read 0. */

import { definePatch, toBool } from "../infra/index.ts";

export interface TimeState {
  time: number;
  frame: number;
}

export const timePatch = definePatch<TimeState>("time", {
  state: () => ({ time: 0, frame: 0 }),
  evaluate(ctx) {
    if (toBool(ctx.input("enabled"))) {
      ctx.state.time = ctx.time;
      ctx.state.frame = ctx.frame;
      ctx.requestNextFrame();
    }
    ctx.output("time", ctx.state.time);
    ctx.output("frame", ctx.state.frame);
  },
  mutedBehavior: "zero",
});
