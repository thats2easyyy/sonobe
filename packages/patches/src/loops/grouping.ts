/** The shared evaluator behind Any and All: one answer for a loop, or one answer per group. */

import type { PatchContext } from "@sonobe/engine";
import { MAX_LOOP_LENGTH, loopOf, toBool, warnOnce } from "../infra/index.ts";

function isGroupId(g: unknown): g is number {
  return typeof g === "number" && Number.isFinite(g) && g >= 0;
}

/**
 * Evaluate a boolean reducer. `mode` "any" answers true when some item is on; "all" answers true
 * when no item is off (groups without items answer the same vacuous truth as an empty loop).
 */
export function evaluateReducer(ctx: PatchContext<unknown>, mode: "any" | "all", patchName: string): void {
  const items = ctx.inputItems<unknown>("loop").map(toBool);
  const groups = ctx.inputItems<unknown>("grouping");
  if (!groups.some(isGroupId)) {
    ctx.output("output", mode === "any" ? items.some(Boolean) : items.every(Boolean));
    return;
  }
  const empty = mode === "all";
  const result: boolean[] = [];
  for (let i = 0; i < items.length; i++) {
    const id = groups[i % groups.length];
    if (!isGroupId(id)) continue;
    const g = Math.floor(id);
    if (g >= MAX_LOOP_LENGTH) {
      warnOnce(ctx, "groupLimit", `${patchName}: group numbers of 10,000 or more are ignored.`);
      continue;
    }
    while (result.length <= g) result.push(empty);
    if (mode === "any" ? items[i] : !items[i]) result[g] = !empty;
  }
  ctx.output("output", loopOf(result));
}
