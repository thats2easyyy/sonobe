/** Loop Append: adds Value to the end on each pulse; appended values follow the current Loop. */

import { MAX_LOOP_LENGTH, definePatch, loopOf, warnOnce } from "../infra/index.ts";
import { indices, passThroughWhenMuted, snapshot, warnIfLooped } from "./shared.ts";

export interface LoopAppendState {
  appended: unknown[];
  variant: string | undefined;
  warned: boolean;
}

export const loopAppendPatch = definePatch<LoopAppendState>("loopAppend", {
  state: () => ({ appended: [], variant: undefined, warned: false }),
  evaluate(ctx) {
    if (passThroughWhenMuted(ctx, "index")) return;
    const state = ctx.state;
    const variant = ctx.typeParam ?? "number";
    if (state.variant !== variant) {
      state.variant = variant;
      state.appended = [];
    }
    warnIfLooped(ctx, ["value", "append", "reset"], "Loop Append: Value, Append, and Reset take single values, so only item 0 of a looped input is used.");
    if (ctx.pulsed("reset")) state.appended = [];
    const items = [...ctx.inputItems("loop"), ...state.appended];
    if (ctx.pulsed("append")) {
      if (items.length >= MAX_LOOP_LENGTH) {
        warnOnce(ctx, "cap", "Loop Append reached 10,000 items, so this append was skipped.");
      } else {
        const value = snapshot(ctx.input<unknown>("value"));
        state.appended.push(value);
        items.push(value);
      }
    }
    ctx.output("output", loopOf(items));
    ctx.output("index", loopOf(indices(items.length)));
  },
  mutedBehavior: "evaluate",
});
