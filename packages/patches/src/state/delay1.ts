/**
 * Delay One Frame: outputs last frame's input. The engine evaluates `delay1` natively, because breaking a
 * feedback cycle at its input needs the compiled graph; this evaluator is the same register for hosts and
 * harnesses that run definitions directly (outside a cycle).
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
