/** Loop Insert: adds Value at Index on each pulse, replaying stored inserts onto the current Loop. */

import { MAX_LOOP_LENGTH, definePatch, loopOf, warnOnce, wholeInRange } from "../infra/index.ts";
import { cachedReplay, indices, passThroughWhenMuted, snapshot, variantPortsFor, warnIfLooped, withMutedBehavior } from "./shared.ts";
import type { ReplayCache } from "./shared.ts";

export interface LoopInsertState {
  inserts: { at: number; value: unknown }[];
  variant: string | undefined;
  warned: boolean;
  cache: ReplayCache | null;
}

/** Position for an insert into `n` items: rounds down (with Option Picker's epsilon), clamps to [0, n]. */
export function clampInsertIndex(x: unknown, n: number): number {
  return typeof x === "number" ? wholeInRange(x, 0, n) : 0;
}

/** The source loop with every stored insert applied in order. */
export function replayInserts(source: readonly unknown[], inserts: LoopInsertState["inserts"]): unknown[] {
  const items = [...source];
  for (const op of inserts) items.splice(clampInsertIndex(op.at, items.length), 0, op.value);
  return items;
}

export const loopInsertPatch = withMutedBehavior(
  definePatch<LoopInsertState>("loopInsert", {
    dynamicPorts: variantPortsFor("loopInsert"),
    state: () => ({ inserts: [], variant: undefined, warned: false, cache: null }),
    evaluate(ctx) {
      if (passThroughWhenMuted(ctx, "outputIndex")) return;
      const state = ctx.state;
      const variant = ctx.typeParam ?? "number";
      if (state.variant !== variant) {
        state.variant = variant;
        state.inserts = [];
        state.cache = null;
      }
      warnIfLooped(ctx, ["value", "index", "insert", "reset"], "Loop Insert: Value, Index, Insert, and Reset take single values, so only item 0 of a looped input is used.");
      if (ctx.pulsed("reset")) {
        state.inserts = [];
        state.cache = null;
      }
      const source = ctx.inputItems("loop");
      const inserts = state.inserts;
      state.cache = cachedReplay(state.cache, source, (s) => replayInserts(s, inserts));
      if (ctx.pulsed("insert")) {
        const current = state.cache.items;
        if (current.length >= MAX_LOOP_LENGTH) {
          warnOnce(ctx, "cap", "Loop Insert reached 10,000 items, so this insert was skipped.");
        } else {
          const at = clampInsertIndex(ctx.input("index"), current.length);
          const value = snapshot(ctx.input<unknown>("value"));
          inserts.push({ at, value });
          const items = [...current];
          items.splice(at, 0, value);
          state.cache = { source: state.cache.source, items };
        }
      }
      const items = state.cache.items;
      ctx.output("output", loopOf(items));
      ctx.output("outputIndex", loopOf(indices(items.length)));
    },
  }),
  "evaluate",
);
