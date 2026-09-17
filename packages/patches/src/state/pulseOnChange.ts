/**
 * Pulse on Change: fires Changed on every frame Value differs from the previous frame, using the
 * variant's equality rule. First evaluations and variant changes only seed history.
 */

import type { Value, ValueType } from "@sonobe/core";
import { definePatch } from "../infra/index.ts";
import { getSpec } from "../specs.ts";
import { sameValue, variantOf } from "./shared.ts";

export interface PulseOnChangeState {
  previous: Value;
  variant: ValueType | undefined;
  seeded: boolean;
}

const SPEC = getSpec("pulseOnChange")!;

export const pulseOnChangePatch = definePatch<PulseOnChangeState>("pulseOnChange", {
  state: () => ({ previous: undefined, variant: undefined, seeded: false }),
  evaluate(ctx) {
    const value = ctx.input<Value>("value");
    const variant = variantOf(ctx, SPEC);
    const s = ctx.state;
    if (!s.seeded || s.variant !== variant) {
      s.previous = value;
      s.variant = variant;
      s.seeded = true;
    } else if (!sameValue(value, s.previous, variant)) {
      ctx.pulse("changed");
      s.previous = value;
    }
  },
});
