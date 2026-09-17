/** Sine: the sine of an angle in degrees, exact at common angles. */

import { definePatch } from "../infra/index.ts";

export interface TrigState {
  warned: boolean;
}

/** Trig results rounded to 12 decimals: removes float fuzz so sine(180) is exactly 0 in every engine. */
export function roundTrig(v: number): number {
  const r = Math.round(v * 1e12) / 1e12;
  return r === 0 ? 0 : r;
}

/** sin of `angle` degrees, reduced mod 360 first so huge angles stay accurate. */
export function sineDegrees(angle: number): number {
  return roundTrig(Math.sin(((angle % 360) * Math.PI) / 180));
}

export const sine = definePatch<TrigState>("sine", {
  state: () => ({ warned: false }),
  evaluate(ctx) {
    let v = sineDegrees(ctx.input<number>("angle"));
    if (!Number.isFinite(v)) {
      v = 0;
      if (!ctx.state.warned) {
        ctx.state.warned = true;
        ctx.services.log("warn", `${ctx.id}: Angle isn't a finite number, so Sine outputs 0`);
      }
    }
    ctx.output("output", v);
  },
});
