/** Equals: true when two numbers or vectors are within a tolerance of each other. */

import type { RuntimePatchDefinition } from "@sonobe/engine";
import { components, definePatch, finiteOr } from "../infra/index.ts";
import { variantResolver } from "./shared.ts";

const variantOf = variantResolver("equals");

/** True when `a` and `b` are within `tolerance` (Euclidean distance for vectors), with a tiny floating-point slack. */
export function withinTolerance(a: readonly number[], b: readonly number[], tolerance: number): boolean {
  let sum = 0;
  let scale = 1;
  for (let i = 0; i < a.length; i++) {
    const x = finiteOr(a[i], 0);
    const y = finiteOr(b[i], 0);
    const d = x - y;
    sum += d * d;
    scale = Math.max(scale, Math.abs(x), Math.abs(y));
  }
  return Math.sqrt(sum) <= Math.abs(finiteOr(tolerance, 0)) + 1e-9 * scale;
}

const definition = definePatch("equals", {
  evaluate(ctx) {
    const variant = variantOf(ctx.typeParam);
    const a = components(ctx.input("value1"), variant);
    const b = components(ctx.input("value2"), variant);
    ctx.output("output", withinTolerance(a, b, ctx.input<number>("tolerance")));
  },
});

export const equals: RuntimePatchDefinition = { ...definition, mutedBehavior: "zero" };
