/** Option Picker: outputs the value of the option Option selects, clamped to the options that exist. */

import type { Value } from "@sonobe/core";
import { definePatch } from "../infra/index.ts";
import { getSpec } from "../specs.ts";
import { optionIndex, optionKeys, optionPorts } from "./shared.ts";

const SPEC = getSpec("optionPicker")!;
const OPTIONS = optionKeys("option", SPEC.variadic!.max);

export const optionPickerPatch = definePatch("optionPicker", {
  dynamicPorts: optionPorts(SPEC),
  evaluate(ctx) {
    const n = Math.min(Math.max(2, ctx.inputCount), OPTIONS.length);
    const i = optionIndex(ctx.input("option"), n);
    ctx.output("output", ctx.input<Value>(OPTIONS[i]!));
  },
});
