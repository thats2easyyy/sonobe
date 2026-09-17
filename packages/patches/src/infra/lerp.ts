/**
 * Interpolation for every interpolable type: numbers and vectors component-wise, colors channel by
 * channel in straight RGBA (gap-fill R12, "Linear RGBA") clamped to 0–1, and gradients stop by
 * stop. `a + t·(b − a)` keeps the start exact at t = 0.
 */

import type { Color, GradientStop, GradientValue, Value, ValueType } from "@sonobe/core";
import { clamp01, componentCount, components, fromComponents, isPlainObject } from "./values.ts";

/** Types that blend smoothly (CONVENTIONS.md §8 INTERPOLABLE, plus gradient). */
export const INTERPOLABLE_TYPES: readonly ValueType[] = ["number", "point", "point3d", "point4d", "size", "anchor", "color", "gradient"];

export function isInterpolable(type: ValueType | string): boolean {
  return (INTERPOLABLE_TYPES as readonly string[]).includes(type);
}

/** Unclamped `a + t·(b − a)`. */
export function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

/** Component-wise lerp; the result has the longer length and missing components read as 0. */
export function lerpComponents(a: readonly number[], b: readonly number[], t: number): number[] {
  const n = Math.max(a.length, b.length);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = lerp(a[i] ?? 0, b[i] ?? 0, t);
  return out;
}

/** Straight RGBA blend, each channel clamped to 0–1 so overshoot can't make an invalid color. */
export function lerpColor(a: Color, b: Color, t: number): Color {
  return { r: clamp01(lerp(a.r, b.r, t)), g: clamp01(lerp(a.g, b.g, t)), b: clamp01(lerp(a.b, b.b, t)), a: clamp01(lerp(a.a, b.a, t)) };
}

export function isGradient(value: unknown): value is GradientValue {
  return isPlainObject(value) && Array.isArray(value.stops);
}

const sortedStops = (g: GradientValue): GradientStop[] => [...g.stops].sort((x, y) => x.offset - y.offset);

/** A gradient's color at `offset` (0–1): neighboring stops blend; past the ends the end colors hold. */
export function sampleGradient(gradient: GradientValue, offset: number): Color {
  const stops = sortedStops(gradient);
  if (stops.length === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (offset <= first.offset) return { ...first.color };
  if (offset >= last.offset) return { ...last.color };
  for (let i = 1; i < stops.length; i++) {
    const s1 = stops[i]!;
    if (offset <= s1.offset) {
      const s0 = stops[i - 1]!;
      const w = s1.offset - s0.offset;
      return w > 0 ? lerpColor(s0.color, s1.color, (offset - s0.offset) / w) : { ...s1.color };
    }
  }
  return { ...last.color };
}

/**
 * Blend two gradients. Matching stop counts blend stop by stop; otherwise both are sampled at the
 * union of their offsets. Start and end points blend, and the kind switches at t = 0.5. When one
 * side is missing, the other is returned.
 */
export function lerpGradient(a: GradientValue | null | undefined, b: GradientValue | null | undefined, t: number): GradientValue | null {
  if (!isGradient(a)) return isGradient(b) ? b : null;
  if (!isGradient(b)) return a;
  let stops: GradientStop[];
  if (a.stops.length === b.stops.length) {
    const sa = sortedStops(a);
    const sb = sortedStops(b);
    stops = sa.map((s, i) => ({ offset: lerp(s.offset, sb[i]!.offset, t), color: lerpColor(s.color, sb[i]!.color, t) }));
  } else {
    const offsets = [...new Set([...a.stops, ...b.stops].map((s) => s.offset))].sort((x, y) => x - y);
    stops = offsets.map((offset) => ({ offset, color: lerpColor(sampleGradient(a, offset), sampleGradient(b, offset), t) }));
  }
  return {
    kind: t < 0.5 ? a.kind : b.kind,
    stops,
    start: [lerp(a.start[0], b.start[0], t), lerp(a.start[1], b.start[1], t)],
    end: [lerp(a.end[0], b.end[0], t), lerp(a.end[1], b.end[1], t)],
  };
}

/**
 * Interpolate two runtime values of `type`. Numbers, vectors, colors, and gradients blend; other
 * types step from `a` to `b` at t = 0.5. A non-finite `t` reads as 0.
 */
export function lerpValue(a: unknown, b: unknown, t: number, type: ValueType | string): Value {
  const p = Number.isFinite(t) ? t : 0;
  if (type === "gradient") return lerpGradient(a as GradientValue | null, b as GradientValue | null, p);
  if (componentCount(type) !== undefined && type !== "boolean") {
    return fromComponents(lerpComponents(components(a, type), components(b, type), p), type);
  }
  return (p < 0.5 ? a : b) as Value;
}
