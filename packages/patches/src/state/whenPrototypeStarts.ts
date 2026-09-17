/** When Prototype Starts: one Started pulse on an instance's first evaluated frame after each restart. */

import { definePatch } from "../infra/index.ts";

export interface WhenPrototypeStartsState {
  fired: boolean;
}

export const whenPrototypeStartsPatch = definePatch<WhenPrototypeStartsState>("whenPrototypeStarts", {
  state: () => ({ fired: false }),
  evaluate(ctx) {
    if (ctx.state.fired) return;
    ctx.state.fired = true;
    ctx.pulse("started");
  },
});
