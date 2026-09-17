/** Spring Preset: a named spring feel output in every parameterization (physical, Pop, and response/damping). */

import { definePatch, springPresetValues } from "../infra/index.ts";
import type { SpringPresetValues } from "../infra/index.ts";
import { withMutedBehavior } from "./shared.ts";

const OUTPUT_KEYS: readonly (keyof SpringPresetValues)[] = ["mass", "tension", "friction", "bounciness", "speed", "response", "dampingFraction"];

export const springPreset = withMutedBehavior(
  definePatch("springPreset", {
    evaluate(ctx) {
      const values = ctx.node.muted
        ? springPresetValues("smooth")
        : springPresetValues(String(ctx.input("preset") ?? ""), ctx.input<number>("duration"), ctx.input<number>("bounce"));
      for (const key of OUTPUT_KEYS) ctx.output(key, values[key]);
    },
  }),
  // Muted, it outputs the Smooth preset rather than passing Duration into Mass.
  "evaluate",
);
