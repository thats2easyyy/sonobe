/**
 * Option Switch: remembers one option number, set by the Set to 0…N pulses. The highest pulsed option
 * wins a same-frame collision, and a lower option count clamps the stored option.
 */

import { definePatch } from "../infra/index.ts";
import { getSpec } from "../specs.ts";
import { optionKeys } from "./shared.ts";

export interface OptionSwitchState {
  option: number;
}

const SPEC = getSpec("optionSwitch")!;
const SET_TO = optionKeys("setTo", SPEC.variadic!.max);

export const optionSwitchPatch = definePatch<OptionSwitchState>("optionSwitch", {
  state: () => ({ option: 0 }),
  evaluate(ctx) {
    const n = Math.min(Math.max(2, ctx.inputCount), SET_TO.length);
    for (let i = n - 1; i >= 0; i--) {
      if (ctx.pulsed(SET_TO[i]!)) {
        ctx.state.option = i;
        break;
      }
    }
    ctx.state.option = Math.min(ctx.state.option, n - 1);
    ctx.output("option", ctx.state.option);
  },
});
