/**
 * Sample and Hold: stores Value on every frame Sample is on and keeps it otherwise. Reset clears to the
 * variant's zero value; a same-frame Sample wins.
 */

import type { Value, ValueType } from "@sonobe/core";
import { definePatch, toBool, zeroValue } from "../infra/index.ts";
import { getSpec } from "../specs.ts";
import { variantOf } from "./shared.ts";

export interface SampleAndHoldState {
  variant: ValueType | undefined;
  held: Value;
}

const SPEC = getSpec("sampleAndHold")!;

export const sampleAndHoldPatch = definePatch<SampleAndHoldState>("sampleAndHold", {
  state: () => ({ variant: undefined, held: undefined }),
  evaluate(ctx) {
    const variant = variantOf(ctx, SPEC);
    const s = ctx.state;
    if (s.variant !== variant) {
      s.variant = variant;
      s.held = zeroValue(variant);
    }
    if (ctx.pulsed("reset")) s.held = zeroValue(variant);
    if (toBool(ctx.input("sample"))) s.held = ctx.input<Value>("value");
    ctx.output("output", s.held);
  },
});
