/**
 * Helpers shared by the logic patches: the variadic count they accept, ordered comparison chains
 * (Greater Than, Less Than, and their Or Equal forms), and the effective variant of a node.
 */

import { resolveTypeParam } from "@sonobe/core";
import type { ValueType } from "@sonobe/core";
import type { PatchDefinition } from "@sonobe/engine";
import { definePatch, finiteOr } from "../infra/index.ts";
import { getSpec } from "../specs.ts";

/** A variadic count clamped into 2–32, the range the logic patches accept (hand-edited files may hold anything). */
export function logicInputCount(count: number): number {
  return Number.isFinite(count) ? Math.min(32, Math.max(2, Math.floor(count))) : 2;
}

/** A resolver for a patch type's effective variant: the node's typeParam when allowed, else the first variant. */
export function variantResolver(type: string): (typeParam: string | undefined) => ValueType {
  const spec = getSpec(type);
  if (!spec) throw new Error(`variantResolver: "${type}" isn't a catalog patch type.`);
  return (typeParam) => resolveTypeParam(spec, typeParam) ?? "number";
}

/** An ordered value as a number: booleans read 1 or 0, and non-finite values read 0. */
export function orderedNumber(value: unknown): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  return finiteOr(value, 0);
}

/**
 * A chained comparison: every value is compared with the next one and every pair must pass
 * (`value1 > value2` AND `value2 > value3` …). Muted, the output is false.
 */
export function defineChainComparison(type: string, compare: (a: number, b: number) => boolean): PatchDefinition {
  return definePatch(type, {
    evaluate(ctx) {
      const n = logicInputCount(ctx.inputCount);
      let previous = orderedNumber(ctx.input("value1"));
      let ok = true;
      for (let i = 2; i <= n; i++) {
        const next = orderedNumber(ctx.input(`value${i}`));
        if (!compare(previous, next)) {
          ok = false;
          break;
        }
        previous = next;
      }
      ctx.output("output", ok);
    },
    mutedBehavior: "zero",
  });
}
