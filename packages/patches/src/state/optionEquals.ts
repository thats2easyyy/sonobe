/**
 * Option Equals: the number of the first option equal to Value (−1 when none match) and whether any matched.
 * Muted, it reports no match.
 */

import type { Value } from "@sonobe/core";
import { definePatch } from "../infra/index.ts";
import { getSpec } from "../specs.ts";
import { isMuted, optionKeys, optionPorts, sameValue, variantOf, withMutedBehavior } from "./shared.ts";

const SPEC = getSpec("optionEquals")!;
const OPTIONS = optionKeys("option", SPEC.variadic!.max);

export const optionEqualsPatch = withMutedBehavior(
  definePatch("optionEquals", {
    dynamicPorts: optionPorts(SPEC),
    evaluate(ctx) {
      let match = -1;
      if (!isMuted(ctx)) {
        const n = Math.min(Math.max(2, ctx.inputCount), OPTIONS.length);
        const variant = variantOf(ctx, SPEC);
        const value = ctx.input<Value>("value");
        for (let i = 0; i < n; i++) {
          if (sameValue(value, ctx.input(OPTIONS[i]!), variant)) {
            match = i;
            break;
          }
        }
      }
      ctx.output("option", match);
      ctx.output("equals", match >= 0);
    },
  }),
  "evaluate",
);
