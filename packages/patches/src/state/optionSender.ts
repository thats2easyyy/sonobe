/** Option Sender: Value goes out of the selected output and Default out of every other one. */

import type { Value } from "@sonobe/core";
import { definePatch } from "../infra/index.ts";
import { getSpec } from "../specs.ts";
import { optionIndex, optionKeys, optionPorts } from "./shared.ts";

const SPEC = getSpec("optionSender")!;
const OUTPUTS = optionKeys("option", SPEC.variadic!.max);

export const optionSenderPatch = definePatch("optionSender", {
  dynamicPorts: optionPorts(SPEC),
  evaluate(ctx) {
    const n = Math.min(Math.max(2, ctx.inputCount), OUTPUTS.length);
    const selected = optionIndex(ctx.input("option"), n);
    const value = ctx.input<Value>("value");
    const fallback = ctx.input<Value>("default");
    for (let i = 0; i < n; i++) ctx.output(OUTPUTS[i]!, i === selected ? value : fallback);
  },
});
