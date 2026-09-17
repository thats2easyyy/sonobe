/** Loop Over Array: one loop item per JSON array element. */

import type { PatchContext } from "@sonobe/engine";
import { definePatch, isLoop, isPlainObject, loopOf, warnOnce } from "../infra/index.ts";
import { indices } from "./shared.ts";

function warnIfSuspicious(ctx: PatchContext<unknown>, value: unknown): void {
  if (isPlainObject(value) && !isLoop(value)) {
    warnOnce(ctx, "object", "Loop Over Array got an object, not an array. Use Value for Key to pick the array inside it.");
  } else if (typeof value === "string" && value.trimStart().startsWith("[")) {
    warnOnce(ctx, "text", "Loop Over Array got text that looks like JSON. Convert it with Text to JSON first.");
  }
}

export const loopOverArrayPatch = definePatch("loopOverArray", {
  evaluate(ctx) {
    const sources = ctx.inputItems<unknown>("array");
    const items: unknown[] = [];
    for (const source of sources) {
      if (Array.isArray(source)) items.push(...source);
      else if (source === null || source === undefined) continue;
      else items.push(source);
    }
    if (sources.length === 1) warnIfSuspicious(ctx, sources[0]);
    ctx.output("items", loopOf(items));
    ctx.output("index", loopOf(indices(items.length)));
  },
  mutedBehavior: "zero",
});
