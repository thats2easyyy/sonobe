/**
 * Helpers shared by the math patches: effective variants, rounding and finite-component rules
 * ("a non-finite result outputs 0 and warns once per restart"), and the typed arithmetic folds
 * behind Add, Subtract, Multiply, Divide, Modulo, Min, and Max.
 */

import { resolveTypeParam } from "@sonobe/core";
import type { ValueType } from "@sonobe/core";
import type { PatchDefinition } from "@sonobe/engine";
import { createArithmeticReport, definePatch, foldArithmetic, warnOnce } from "../infra/index.ts";
import type { ArithmeticOp, OnceContext } from "../infra/index.ts";
import { getSpec } from "../specs.ts";

/** A resolver for a patch type's effective variant: the node's typeParam when allowed, else the first variant. */
export function variantResolver(type: string): (typeParam: string | undefined) => ValueType {
  const spec = getSpec(type);
  if (!spec) throw new Error(`variantResolver: "${type}" isn't a catalog patch type.`);
  return (typeParam) => resolveTypeParam(spec, typeParam) ?? "number";
}

/** Round half away from zero: 2.5 → 3 and −2.5 → −3. */
export function roundHalfAwayFromZero(x: number): number {
  return Math.sign(x) * Math.floor(Math.abs(x) + 0.5);
}

/** Replace non-finite components with 0 and fold -0 to 0, in place. Returns true when something wasn't finite. */
export function finiteComponents(values: number[]): boolean {
  let replaced = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) {
      values[i] = 0;
      replaced = true;
    } else if (v === 0) {
      values[i] = 0;
    }
  }
  return replaced;
}

/** Warn once per restart that part of a result wasn't a finite number and became 0. */
export function warnNonFinite(ctx: OnceContext, what = "The result"): void {
  warnOnce(ctx, "nonFinite", `${ctx.id}: ${what} isn't a finite number, so that part outputs 0.`);
}

/** The variadic count clamped into 2–32 (hand-edited files may hold anything). */
export function mathInputCount(count: number): number {
  return Number.isFinite(count) ? Math.min(32, Math.max(2, Math.floor(count))) : 2;
}

/**
 * A variadic arithmetic patch: a left fold of `value1…valueN` with `op`, component-wise for vector
 * variants (text joins for Add). Zero divisors and non-finite components output 0 and warn once.
 */
export function defineArithmetic(type: string, op: ArithmeticOp): PatchDefinition {
  const variantOf = variantResolver(type);
  return definePatch(type, {
    evaluate(ctx) {
      const variant = variantOf(ctx.typeParam);
      const n = mathInputCount(ctx.inputCount);
      const values = new Array<unknown>(n);
      for (let i = 0; i < n; i++) values[i] = ctx.input(`value${i + 1}`);
      const report = createArithmeticReport();
      const result = foldArithmetic(op, values, variant, report);
      if (report.zeroDivisor !== null) warnOnce(ctx, "zeroDivisor", `${ctx.id}: Value ${report.zeroDivisor + 1} is 0, so the output is 0.`);
      if (report.nonFinite) warnNonFinite(ctx);
      ctx.output("output", result);
    },
  });
}
