/**
 * Device Motion: tilt, acceleration (g), and rotation rate (degrees per second) from the host's
 * latest sensor sample. Holds the last sample while disabled; derives Tilt from gravity when a
 * sample has no attitude.
 */

import { clamp, definePatch, normalizeZero, toBool } from "../infra/index.ts";
import { finiteVector } from "./shared.ts";

interface MotionState {
  tilt: number[];
  acceleration: number[];
  rotationRate: number[];
  available: boolean;
}

const DEG = 180 / Math.PI;

/**
 * Tilt in degrees from a gravity vector in g: x front to back, y side to side, z 0. Returns
 * `previous` when |g| < 0.1 (free fall or no data). Face up → [0, 0, 0]; upright → [90, 0, 0].
 */
export function tiltFromGravity(g: readonly number[], previous: readonly number[]): number[] {
  const gx = g[0] ?? 0;
  const gy = g[1] ?? 0;
  const gz = g[2] ?? 0;
  const n = Math.hypot(gx, gy, gz);
  if (!(n >= 0.1)) return [...previous];
  const x = Math.atan2(normalizeZero(-gy), normalizeZero(-gz)) * DEG;
  const y = Math.asin(clamp(gx / n, -1, 1)) * DEG;
  return [normalizeZero(x), normalizeZero(y), 0];
}

const NON_FINITE = "Device Motion: the sensor reported a value that isn't a finite number, so it reads 0.";

export const deviceMotionPatch = definePatch<MotionState>("deviceMotion", {
  mutedBehavior: "zero",
  state: () => ({ tilt: [0, 0, 0], acceleration: [0, 0, 0], rotationRate: [0, 0, 0], available: false }),
  evaluate(ctx) {
    const s = ctx.state;
    if (toBool(ctx.input("enabled"))) {
      const sample = ctx.services.platform.deviceMotion?.();
      if (sample) {
        s.available = true;
        s.acceleration = finiteVector(ctx, sample.acceleration, 3, "nonFinite", NON_FINITE);
        s.rotationRate = finiteVector(ctx, sample.rotationRate, 3, "nonFinite", NON_FINITE);
        // Samples without attitude (simulation, hosts without an orientation sensor) derive Tilt from gravity.
        const attitude = sample.attitude;
        s.tilt = Array.isArray(attitude) ? finiteVector(ctx, attitude, 3, "nonFinite", NON_FINITE) : tiltFromGravity(s.acceleration, s.tilt);
      }
      ctx.requestNextFrame();
    } else {
      s.available = false;
    }
    ctx.output("tilt", [...s.tilt]);
    ctx.output("acceleration", [...s.acceleration]);
    ctx.output("rotationRate", [...s.rotationRate]);
    ctx.output("available", s.available);
  },
});
