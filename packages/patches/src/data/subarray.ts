/** Subarray: up to Length elements of a JSON array, starting at Start. */

import { definePatch, toNumber } from "../infra/index.ts";
import { warnIndexed } from "./shared.ts";

const wholeOrZero = (x: unknown): number => {
  const n = typeof x === "number" ? x : toNumber(x, Number.NaN);
  return Number.isFinite(n) ? Math.floor(n + 1e-6) : 0;
};

export const subarray = definePatch("subarray", {
  evaluate(ctx) {
    const array = ctx.input("array");
    if (!Array.isArray(array)) {
      if (array !== null && array !== undefined) warnIndexed(ctx, "notArray", "Array isn't a JSON array, so Subarray outputs [].");
      ctx.output("output", []);
      return;
    }
    const start = Math.max(0, wholeOrZero(ctx.input("start")));
    const length = wholeOrZero(ctx.input("length"));
    ctx.output("output", length <= 0 || start >= array.length ? [] : array.slice(start, Math.min(array.length, start + length)));
  },
});
