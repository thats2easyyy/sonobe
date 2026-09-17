/**
 * Curve lookup for easing enums (CONVENTIONS.md §11.1), wrapping the engine's Penner curves,
 * plus the tangent extension outside 0–1 that the Curve and Keyframes patches share.
 */

import { evaluateCurve, getCurve } from "@sonobe/engine";
import type { EasingFunction } from "@sonobe/engine";

/** The 13 CURVE options every easing enum offers, in picker order. */
export const CURVE_KEYS = [
  "linear",
  "quadraticIn",
  "quadraticOut",
  "quadraticInOut",
  "cubicIn",
  "cubicOut",
  "cubicInOut",
  "exponentialIn",
  "exponentialOut",
  "exponentialInOut",
  "sinusoidalIn",
  "sinusoidalOut",
  "sinusoidalInOut",
] as const;

export type CurveOptionKey = (typeof CURVE_KEYS)[number];

const linear: EasingFunction = (t) => t;

/** Easing function for a curve key, display name, or alias; undefined when unknown. */
export function curveFunction(key: string): EasingFunction | undefined {
  return getCurve(key)?.fn;
}

/** True when `key` names a curve. */
export function isKnownCurve(key: string): boolean {
  return getCurve(key) !== undefined;
}

/** Easing function for `key`, falling back to linear for unknown keys. */
export function curveOrLinear(key: string): EasingFunction {
  return getCurve(key)?.fn ?? linear;
}

/** Eased progress for `key` at `t` (clamped to 0–1). Unknown keys act as linear. */
export function ease(key: string, t: number): number {
  return evaluateCurve(key, t);
}

const LN2_10 = 10 * Math.LN2;
const HALF_PI = Math.PI / 2;

/** Slopes at 0 and at 1 for the CURVE options, keyed by engine curve key (Curve patch table). */
const SLOPES: Record<string, readonly [number, number]> = {
  linear: [1, 1],
  quadraticIn: [0, 2],
  quadraticOut: [2, 0],
  quadraticInOut: [0, 0],
  cubicIn: [0, 3],
  cubicOut: [3, 0],
  cubicInOut: [0, 0],
  exponentialIn: [LN2_10 / 1024, LN2_10],
  exponentialOut: [LN2_10, LN2_10 / 1024],
  exponentialInOut: [LN2_10 / 1024, LN2_10 / 1024],
  sineIn: [0, HALF_PI],
  sineOut: [HALF_PI, 0],
  sineInOut: [0, 0],
};

/** Slopes of a curve at t = 0 and t = 1 (numeric for curves outside the CURVE options; linear when unknown). */
export function curveSlopes(key: string): { start: number; end: number } {
  const curve = getCurve(key);
  if (!curve) return { start: 1, end: 1 };
  const exact = SLOPES[curve.key];
  if (exact) return { start: exact[0], end: exact[1] };
  // Sample just inside 0–1: several engine curves special-case the exact endpoints.
  const h = 1e-6;
  return { start: (curve.fn(2 * h) - curve.fn(h)) / h, end: (curve.fn(1 - h) - curve.fn(1 - 2 * h)) / h };
}

/**
 * Eased progress with straight-line, tangent extension outside 0–1: `slope0·p` below 0 and
 * `1 + slope1·(p − 1)` above 1. Non-finite progress gives 0. Unknown keys act as linear.
 */
export function easeExtended(key: string, p: number): number {
  if (!Number.isFinite(p)) return 0;
  if (p < 0) return curveSlopes(key).start * p;
  if (p > 1) return 1 + curveSlopes(key).end * (p - 1);
  return ease(key, p);
}
