/** Small vector and scalar helpers shared by physics, layout, hit testing, and gestures. */

import type { Color } from "@sonobe/core";

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

/** Clamp `value` into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Unclamped linear interpolation: `a + t × (b − a)`. */
export function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

/** Component-wise unclamped interpolation; the result has the length of the longer input. */
export function lerpVec(a: readonly number[], b: readonly number[], t: number): number[] {
  const n = Math.max(a.length, b.length);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = lerp(a[i] ?? 0, b[i] ?? 0, t);
  return out;
}

/** True when |a − b| ≤ epsilon. */
export function approxEqual(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) <= epsilon;
}

/** A finite number, or `fallback` for NaN, ±Infinity, and non-numbers. */
export function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function add2(a: readonly number[], b: readonly number[]): Vec2 {
  return [(a[0] ?? 0) + (b[0] ?? 0), (a[1] ?? 0) + (b[1] ?? 0)];
}

export function sub2(a: readonly number[], b: readonly number[]): Vec2 {
  return [(a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0)];
}

export function scale2(a: readonly number[], s: number): Vec2 {
  return [(a[0] ?? 0) * s, (a[1] ?? 0) * s];
}

export function length2(a: readonly number[]): number {
  return Math.hypot(a[0] ?? 0, a[1] ?? 0);
}

export function distance2(a: readonly number[], b: readonly number[]): number {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0));
}

/**
 * Coerce a runtime value into a 2-vector: arrays take their first two components,
 * a number broadcasts to both, anything else yields `fallback`.
 */
export function toVec2(value: unknown, fallback: readonly [number, number] = [0, 0]): Vec2 {
  if (typeof value === "number") {
    const v = finiteOr(value, fallback[0]);
    return [v, v];
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const arr = value as ArrayLike<unknown>;
    return [finiteOr(arr[0], fallback[0]), finiteOr(arr[1], fallback[1])];
  }
  return [fallback[0], fallback[1]];
}

/**
 * Coerce a runtime value into a 4-vector (edges, corner radii): a number broadcasts,
 * `[a, b]` expands to `[a, b, a, b]`, `[a, b, c]` to `[a, b, c, b]`.
 */
export function toVec4(
  value: unknown,
  fallback: readonly [number, number, number, number] = [0, 0, 0, 0],
): Vec4 {
  if (typeof value === "number") {
    const v = finiteOr(value, 0);
    return [v, v, v, v];
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const arr = value as ArrayLike<unknown>;
    if (arr.length === 0) return [...fallback];
    const a = finiteOr(arr[0], fallback[0]);
    const b = arr.length > 1 ? finiteOr(arr[1], fallback[1]) : a;
    const c = arr.length > 2 ? finiteOr(arr[2], fallback[2]) : a;
    const d = arr.length > 3 ? finiteOr(arr[3], fallback[3]) : b;
    return [a, b, c, d];
  }
  return [...fallback];
}

/** Runtime color → `[r, g, b, a]` for component-wise physics. */
export function colorToVec4(color: Color): Vec4 {
  return [color.r, color.g, color.b, color.a];
}

/** `[r, g, b, a]` → runtime color, clamped to 0..1. */
export function vec4ToColor(v: readonly number[]): Color {
  return {
    r: clamp(v[0] ?? 0, 0, 1),
    g: clamp(v[1] ?? 0, 0, 1),
    b: clamp(v[2] ?? 0, 0, 1),
    a: clamp(v[3] ?? 1, 0, 1),
  };
}

/** Format a number for generated code: rounded, trailing zeros trimmed, no `-0`. */
export function formatNumber(value: number, maxDecimals = 4): string {
  if (!Number.isFinite(value)) return "0";
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(value * factor) / factor;
  if (Object.is(rounded, -0) || rounded === 0) return "0";
  return rounded.toFixed(maxDecimals).replace(/\.?0+$/, "");
}
