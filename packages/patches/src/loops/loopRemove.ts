/** Loop Remove: removes the item at Index on each pulse, replaying stored removals onto the current Loop. */

import { definePatch, loopOf, whole } from "../infra/index.ts";
import { cachedReplay, indices, passThroughWhenMuted, warnIfLooped } from "./shared.ts";
import type { ReplayCache } from "./shared.ts";

export interface LoopRemoveState {
  removals: number[];
  variant: string | undefined;
  warned: boolean;
  cache: ReplayCache | null;
}

/** The source loop with every stored removal applied in order; positions past the end are skipped. */
export function replayRemovals(source: readonly unknown[], removals: readonly number[]): unknown[] {
  const items = [...source];
  for (const at of removals) if (at < items.length) items.splice(at, 1);
  return items;
}

export const loopRemovePatch = definePatch<LoopRemoveState>("loopRemove", {
  state: () => ({ removals: [], variant: undefined, warned: false, cache: null }),
  evaluate(ctx) {
    if (passThroughWhenMuted(ctx, "outputIndex")) return;
    const state = ctx.state;
    const variant = ctx.typeParam ?? "number";
    if (state.variant !== variant) {
      state.variant = variant;
      state.removals = [];
      state.cache = null;
    }
    warnIfLooped(ctx, ["index", "remove", "reset"], "Loop Remove: Index, Remove, and Reset take single values, so only item 0 of a looped input is used.");
    if (ctx.pulsed("reset")) {
      state.removals = [];
      state.cache = null;
    }
    const source = ctx.inputItems("loop");
    const removals = state.removals;
    state.cache = cachedReplay(state.cache, source, (s) => replayRemovals(s, removals));
    if (ctx.pulsed("remove")) {
      const current = state.cache.items;
      const raw = ctx.input<unknown>("index");
      const at = typeof raw === "number" ? whole(raw) : Number.NaN;
      if (at >= 0 && at < current.length) {
        removals.push(at);
        const items = [...current];
        items.splice(at, 1);
        state.cache = { source: state.cache.source, items };
      }
    }
    const items = state.cache.items;
    ctx.output("output", loopOf(items));
    ctx.output("outputIndex", loopOf(indices(items.length)));
  },
  mutedBehavior: "evaluate",
});
