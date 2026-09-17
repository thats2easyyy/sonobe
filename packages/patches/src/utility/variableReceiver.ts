/**
 * Variable Receiver: the engine evaluates receivers natively, reading the resolved broadcaster's
 * value on the same frame. This evaluator only runs outside that compiler (isolated harnesses,
 * runtimes without variable support), where nothing resolves, so it outputs the type's zero value.
 */

import type { RuntimePatchDefinition } from "@sonobe/engine";
import { definePatch, zeroValue } from "../infra/index.ts";

export const variableReceiver: RuntimePatchDefinition = {
  ...definePatch("variableReceiver", {
    evaluate(ctx) {
      ctx.output("output", zeroValue(ctx.typeParam ?? "number"));
    },
  }),
  mutedBehavior: "zero",
};
