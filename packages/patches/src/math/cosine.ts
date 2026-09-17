/** Cosine: the cosine of an angle in degrees, exact at common angles. */

import { definePatch } from "../infra/index.ts";
import { roundTrig } from "./sine.ts";
import type { TrigState } from "./sine.ts";

/** cos of `angle` degrees, reduced mod 360 first so huge angles stay accurate. */
export function cosineDegrees(angle: number): number {
  return roundTrig(Math.cos(((angle % 360) * Math.PI) / 180));
}

export const cosine = definePatch<TrigState>("cosine", {
  state: () => ({ warned: false }),
  evaluate(ctx) {
    let v = cosineDegrees(ctx.input<number>("angle"));
    if (!Number.isFinite(v)) {
      v = 0;
      if (!ctx.state.warned) {
        ctx.state.warned = true;
        ctx.services.log("warn", `${ctx.id}: Angle isn't a finite number, so Cosine outputs 0`);
      }
    }
    ctx.output("output", v);
  },
});
