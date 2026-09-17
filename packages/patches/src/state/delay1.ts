/**
 * Delay One Frame: outputs last frame's input. When the compiler breaks a feedback cycle at this patch's
 * Value (`ctx.isFeedback("value")`), the back-edge read already is last frame's value, so it passes
 * through; otherwise the patch keeps a one-frame register. The engine still evaluates `delay1` with its
 * own built-in copy of this evaluator.
 */

import type { Value, ValueType } from "@sonobe/core";
import { definePatch } from "../infra/index.ts";
import { getSpec } from "../specs.ts";
import { pulseOnFirstFrame, sameValue, variantOf } from "./shared.ts";

export interface Delay1State {
  seeded: boolean;
  variant: ValueType | undefined;
  held: Value;
}

const SPEC = getSpec("delay1")!;

export const delay1Patch = definePatch<Delay1State>("delay1", {
  state: () => ({ seeded: false, variant: undefined, held: undefined }),
  evaluate(ctx) {
    if (ctx.isFeedback("value")) {
      // The driver evaluates later this frame, so the read is already one frame late (the port default on frame 0).
      ctx.output("output", ctx.input<Value>("value"));
      return;
    }
    const s = ctx.state;
    const variant = variantOf(ctx, SPEC);
    const v = ctx.input<Value>("value");
    if (!s.seeded || s.variant !== variant) {
      s.seeded = true;
      s.variant = variant;
      s.held = pulseOnFirstFrame(ctx, "value", variant) ? false : v;
    }
    ctx.output("output", s.held);
    if (!sameValue(s.held, v, variant, "exact")) ctx.requestNextFrame();
    s.held = v;
  },
});
