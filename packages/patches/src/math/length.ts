/** Length: the distance from zero: |value| for numbers, Euclidean length for vectors. */

import { components, definePatch } from "../infra/index.ts";
import { variantResolver } from "./shared.ts";
import type { TrigState } from "./sine.ts";

const variantOf = variantResolver("length");

/** √Σc² (not Math.hypot, so every engine returns bit-identical results). */
export function vectorLength(parts: readonly number[]): number {
  let sum = 0;
  for (const c of parts) sum += c * c;
  return Math.sqrt(sum);
}

export const length = definePatch<TrigState>("length", {
  state: () => ({ warned: false }),
  evaluate(ctx) {
    let len = vectorLength(components(ctx.input("value"), variantOf(ctx.typeParam)));
    if (!Number.isFinite(len)) {
      len = 0;
      if (!ctx.state.warned) {
        ctx.state.warned = true;
        ctx.services.log("warn", `${ctx.id}: Value is too large or isn't a number, so Length outputs 0`);
      }
    }
    ctx.output("length", len);
  },
});
