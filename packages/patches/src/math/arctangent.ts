/** Arctangent: the direction of (X, Y) in degrees, (-180, 180], clockwise on screen because Y points down. */

import { definePatch } from "../infra/index.ts";
import type { TrigState } from "./sine.ts";

/** atan2(y, x) in degrees, rounded to 12 decimals, with -180 folded to 180 and -0 to 0 (NaN stays NaN). */
export function arctangentDegrees(y: number, x: number): number {
  let deg = Math.round(((Math.atan2(y, x) * 180) / Math.PI) * 1e12) / 1e12;
  if (deg === -180) deg = 180;
  return deg === 0 ? 0 : deg;
}

export const arctangent = definePatch<TrigState>("arctangent", {
  state: () => ({ warned: false }),
  evaluate(ctx) {
    let deg = arctangentDegrees(ctx.input<number>("y"), ctx.input<number>("x"));
    if (!Number.isFinite(deg)) {
      deg = 0;
      if (!ctx.state.warned) {
        ctx.state.warned = true;
        ctx.services.log("warn", `${ctx.id}: Y or X isn't a number, so Arctangent outputs 0`);
      }
    }
    ctx.output("angle", deg);
  },
});
