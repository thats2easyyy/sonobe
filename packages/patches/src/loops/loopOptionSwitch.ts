/** Loop Option Switch: remembers the position of the item that pulsed most recently. */

import { definePatch, toBool } from "../infra/index.ts";

export interface LoopOptionSwitchState {
  option: number;
  /** Last frame's on/off reading per item. */
  prev: boolean[];
}

export const loopOptionSwitchPatch = definePatch<LoopOptionSwitchState>("loopOptionSwitch", {
  state: () => ({ option: 0, prev: [] }),
  evaluate(ctx) {
    const state = ctx.state;
    const items = ctx.inputItems<unknown>("select");
    const on = items.map(toBool);
    // Ascending, so the highest firing index wins.
    for (let i = 0; i < on.length; i++) if (on[i] && !state.prev[i]) state.option = i;
    state.prev = on;
    const n = on.length;
    ctx.output("option", n === 0 ? 0 : Math.min(state.option, n - 1));
  },
});
