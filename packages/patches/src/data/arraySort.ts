/** Array Sort: a stably sorted copy of a JSON array, by the elements or by one field. */

import { definePatch, isPlainObject, toText } from "../infra/index.ts";
import { warnIndexed } from "./shared.ts";

const MISSING: unique symbol = Symbol("missing");

function rank(v: unknown): number {
  if (v === MISSING) return 6;
  if (v === null || v === undefined) return 0;
  if (typeof v === "boolean") return 1;
  if (typeof v === "number") return 2;
  if (typeof v === "string") return 3;
  return Array.isArray(v) ? 4 : 5;
}

/**
 * Ascending order for JSON values: null < booleans < numbers < text < arrays < objects. Text
 * compares case-insensitively by code units, with uppercase first on ties; arrays and objects tie.
 */
export function compareJson(a: unknown, b: unknown): number {
  const r = rank(a) - rank(b);
  if (r !== 0) return r;
  if (typeof a === "boolean") return a === b ? 0 : a ? 1 : -1;
  if (typeof a === "number") {
    const nb = b as number;
    return a < nb ? -1 : a > nb ? 1 : 0;
  }
  if (typeof a === "string") {
    const sb = b as string;
    const la = a.toLowerCase();
    const lb = sb.toLowerCase();
    if (la !== lb) return la < lb ? -1 : 1;
    return a < sb ? -1 : a > sb ? 1 : 0;
  }
  return 0;
}

export const arraySort = definePatch("arraySort", {
  evaluate(ctx) {
    const array = ctx.input("array");
    if (!Array.isArray(array)) {
      if (array !== null && array !== undefined) warnIndexed(ctx, "notArray", "Array isn't a JSON array, so Array Sort outputs [].");
      ctx.output("output", []);
      return;
    }
    const key = toText(ctx.input("key"));
    const descending = ctx.input("sortBy") === "descending";
    const sortValue = (item: unknown): unknown => (key === "" ? item : isPlainObject(item) && Object.hasOwn(item, key) ? item[key] : MISSING);
    const decorated = array.map((item: unknown, i: number) => ({ item, v: sortValue(item), i }));
    decorated.sort((x, y) => {
      const xm = x.v === MISSING;
      const ym = y.v === MISSING;
      if (xm || ym) return xm === ym ? x.i - y.i : xm ? 1 : -1;
      const c = descending ? -compareJson(x.v, y.v) : compareJson(x.v, y.v);
      return c !== 0 ? c : x.i - y.i;
    });
    ctx.output(
      "output",
      decorated.map((d) => d.item),
    );
  },
});
