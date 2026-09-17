/** Equals Exactly: true when every value matches Value 1 with no tolerance. */

import type { ValueType } from "@sonobe/core";
import { clamp01, components, definePatch, equalValues, isPlainObject } from "../infra/index.ts";
import { logicInputCount, variantResolver } from "./shared.ts";

const variantOf = variantResolver("equalsExactly");

const MAX_JSON_DEPTH = 256;

/** Deep JSON equality: same kind, arrays item by item, objects by key set (order ignored), numbers with `===`. */
export function jsonEqual(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true;
  if (depth > MAX_JSON_DEPTH) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i], depth + 1)) return false;
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) if (!Object.hasOwn(b, key) || !jsonEqual(a[key], b[key], depth + 1)) return false;
    return true;
  }
  return false;
}

const colorByte = (channel: number) => Math.round(clamp01(channel) * 255);

/** Exact equality for a variant type (the rules in the catalog behavior). */
export function exactlyEqual(a: unknown, b: unknown, type: ValueType): boolean {
  switch (type) {
    case "color": {
      const ca = components(a, "color");
      const cb = components(b, "color");
      for (let i = 0; i < 4; i++) if (colorByte(ca[i]!) !== colorByte(cb[i]!)) return false;
      return true;
    }
    case "point":
    case "point3d":
    case "point4d":
    case "size":
    case "anchor": {
      if (!Array.isArray(a) || !Array.isArray(b)) return equalValues(a, b);
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    }
    case "json":
      return jsonEqual(a, b);
    default:
      return a === b;
  }
}

export const equalsExactly = definePatch("equalsExactly", {
  evaluate(ctx) {
    const variant = variantOf(ctx.typeParam);
    const n = logicInputCount(ctx.inputCount);
    const base = ctx.input("value1");
    let same = true;
    for (let i = 2; i <= n; i++) {
      if (!exactlyEqual(base, ctx.input(`value${i}`), variant)) {
        same = false;
        break;
      }
    }
    ctx.output("output", same);
  },
  mutedBehavior: "zero",
});
