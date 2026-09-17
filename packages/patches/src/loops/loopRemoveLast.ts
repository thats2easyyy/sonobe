/** Loop Remove Last: takes one item off the end per pulse; the stored count applies to the current Loop. */

import { definePatch, loopOf } from "../infra/index.ts";
import { indices, passThroughWhenMuted, variantPortsFor, warnIfLooped, withMutedBehavior } from "./shared.ts";

export interface LoopRemoveLastState {
  removed: number;
  variant: string | undefined;
  warned: boolean;
}

export const loopRemoveLastPatch = withMutedBehavior(
  definePatch<LoopRemoveLastState>("loopRemoveLast", {
    dynamicPorts: variantPortsFor("loopRemoveLast"),
    state: () => ({ removed: 0, variant: undefined, warned: false }),
    evaluate(ctx) {
      if (passThroughWhenMuted(ctx, "index")) return;
      const state = ctx.state;
      const variant = ctx.typeParam ?? "number";
      if (state.variant !== variant) {
        state.variant = variant;
        state.removed = 0;
      }
      warnIfLooped(ctx, ["removeLast", "reset"], "Loop Remove Last: Remove Last and Reset listen to one pulse, so only item 0 of a looped input counts.");
      if (ctx.pulsed("reset")) state.removed = 0;
      const source = ctx.inputItems("loop");
      let items = source.slice(0, Math.max(0, source.length - state.removed));
      if (ctx.pulsed("removeLast") && items.length > 0) {
        state.removed += 1;
        items = items.slice(0, -1);
      }
      ctx.output("output", loopOf(items));
      ctx.output("index", loopOf(indices(items.length)));
    },
  }),
  "evaluate",
);
