/** Loop Select: pick items by position, in any order, with repeats; Out of Range decides what's past the ends. */

import type { EmptyLoopFix } from "@sonobe/engine";
import { definePatch, loopOf } from "../infra/index.ts";
import { indices } from "./shared.ts";

const FIXES: readonly EmptyLoopFix[] = [
  { input: "outOfRange", value: "clamp", description: "Set Out of Range to Clamp: an index past the end takes the last item" },
  { input: "outOfRange", value: "fallback", description: "Set Out of Range to Use Fallback: an index past the end gives Fallback (set Fallback to what a missing item means)" },
];

/** "index 3", "indices 1, 2 and 3", "indices 4, 5, 6 and 9 more". */
function indexList(values: readonly number[]): string {
  const unique = [...new Set(values)];
  if (unique.length === 1) return `index ${unique[0]}`;
  const shown = unique.length > 4 ? [...unique.slice(0, 3), `${unique.length - 3} more`] : unique.map(String);
  return `indices ${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

export const loopSelectPatch = definePatch("loopSelect", {
  evaluate(ctx) {
    const items = ctx.inputItems("loop");
    const picks = ctx.inputItems<unknown>("index");
    const mode = ctx.input<string>("outOfRange");
    const n = items.length;
    const out: unknown[] = [];
    const pastEnd: number[] = [];
    for (const raw of picks) {
      const i = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : Number.NaN;
      if (i >= 0 && i < n) out.push(items[i]);
      else if (mode !== "clamp" && mode !== "wrap" && mode !== "fallback") {
        // Skip: never count from the end.
        if (i >= n) pastEnd.push(i);
      } else if (Number.isNaN(i) || n === 0 || mode === "fallback") out.push(ctx.input("fallback"));
      else if (mode === "clamp") out.push(items[i < 0 ? 0 : n - 1]);
      else out.push(items[((i % n) + n) % n]);
    }
    ctx.output("output", loopOf(out));
    ctx.output("outputIndex", loopOf(indices(out.length)));
    // An empty Loop is upstream's doing, and −1 alone means "nothing selected": only explain indices past the end.
    if (out.length === 0 && n > 0 && pastEnd.length > 0) {
      const list = indexList(pastEnd);
      ctx.explainEmpty?.(`${list} ${list.startsWith("index ") ? "is" : "are"} past the end of its ${n}-item Loop`, FIXES);
    }
  },
});
