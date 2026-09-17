/**
 * Helpers shared by the state patches: the effective variant, the value-equality rules the
 * catalog specifies, pulse sources and muting, option numbers, and duration inputs.
 */

import { isColor, resolveTypeParam } from "@sonobe/core";
import type { PatchSpec, ValueType } from "@sonobe/core";
import type { PatchContext } from "@sonobe/engine";
import { isPlainObject, safeDuration, warnOnce } from "../infra/index.ts";

/** The node's effective variant: its typeParam when the spec allows it, else the first variant. */
export function variantOf(ctx: Pick<PatchContext, "typeParam">, spec: PatchSpec): ValueType {
  return resolveTypeParam(spec, ctx.typeParam) ?? "number";
}

// ---------------------------------------------------------------------------
// Equality
// ---------------------------------------------------------------------------

const VECTOR_TYPES: ReadonlySet<string> = new Set(["point", "point3d", "point4d", "size", "anchor"]);
const MEDIA_TYPES: ReadonlySet<string> = new Set(["image", "video", "sound"]);

/** `===`, except that NaN equals NaN so a steady NaN never counts as a change. */
function sameNumber(a: unknown, b: unknown): boolean {
  return a === b || (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b));
}

/** Deep JSON equality: same kind; arrays element by element in order; objects with the same keys in any order. */
export function jsonEqual(a: unknown, b: unknown, depth = 0): boolean {
  if (sameNumber(a, b)) return true;
  if (depth > 64 || typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i], depth + 1)) return false;
    return true;
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = Object.keys(ra);
  if (keys.length !== Object.keys(rb).length) return false;
  for (const key of keys) if (!Object.hasOwn(rb, key) || !jsonEqual(ra[key], rb[key], depth + 1)) return false;
  return true;
}

const channel8 = (c: number) => Math.round(c * 255);

/** How colors compare: at document precision (8 bits per channel) or exactly. */
export type ColorPrecision = "8bit" | "exact";

/**
 * Value equality by variant (CONVENTIONS.md behavior text for Pulse on Change, Option Equals, Delay):
 * numbers and indices with `===` (0 equals −0), booleans, enum keys and text strictly, vectors component by
 * component, colors per channel (8-bit or exact), layer references by id and copy, media by asset id or url,
 * and everything else (json, gradients, shapes, effects) deeply.
 */
export function sameValue(a: unknown, b: unknown, variant: ValueType, colors: ColorPrecision = "8bit"): boolean {
  switch (variant) {
    case "number":
    case "index":
      return sameNumber(a, b);
    case "boolean":
    case "enum":
    case "text":
      return a === b;
    case "color":
      if (isColor(a) && isColor(b)) {
        return colors === "exact"
          ? sameNumber(a.r, b.r) && sameNumber(a.g, b.g) && sameNumber(a.b, b.b) && sameNumber(a.a, b.a)
          : channel8(a.r) === channel8(b.r) && channel8(a.g) === channel8(b.g) && channel8(a.b) === channel8(b.b) && channel8(a.a) === channel8(b.a);
      }
      return jsonEqual(a, b);
    case "layer":
      if (isPlainObject(a) && isPlainObject(b)) return a.layerId === b.layerId && (a.instance ?? null) === (b.instance ?? null);
      return a === b;
    default:
      if (VECTOR_TYPES.has(variant) && Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!sameNumber(a[i], b[i])) return false;
        return true;
      }
      if (MEDIA_TYPES.has(variant) && isPlainObject(a) && isPlainObject(b)) {
        return (a.assetId ?? null) === (b.assetId ?? null) && (a.url ?? null) === (b.url ?? null);
      }
      return jsonEqual(a, b);
  }
}

// ---------------------------------------------------------------------------
// Pulse sources and muting
// ---------------------------------------------------------------------------

/** Whether the patch is muted, directly or through a muted component instance around it (`ctx.muted`). */
export function isMuted(ctx: Pick<PatchContext, "muted">): boolean {
  return ctx.muted === true;
}

/** Whether input `key` is driven by a pulse output, as opposed to a held state (`ctx.isPulseSource`). */
export function drivenByPulse(ctx: Pick<PatchContext, "isPulseSource">, key: string): boolean {
  return ctx.isPulseSource(key) === true;
}

/**
 * True when a boolean-variant input is driven by a pulse output and carries that pulse on this patch's
 * first evaluation (frame 0, or a new loop index). Patches that seed history from the first value (Delay,
 * Delay One Frame) seed `false` then, so the pulse is an event instead of a starting state: a When
 * Prototype Starts pulse into a looped Delay launches every staggered item on time. A held state that is
 * already on at launch still seeds as on.
 */
export function pulseOnFirstFrame(ctx: Pick<PatchContext, "isPulseSource" | "pulsed">, key: string, variant: ValueType): boolean {
  return variant === "boolean" && drivenByPulse(ctx, key) && ctx.pulsed(key);
}

// ---------------------------------------------------------------------------
// Option numbers
// ---------------------------------------------------------------------------

/** Expanded option keys `${key}0…${key}31`, precomputed so evaluators don't build strings every frame. */
export function optionKeys(key: string, max = 32): readonly string[] {
  return Array.from({ length: max }, (_, i) => `${key}${i}`);
}

/** An option number read as a whole number with a 1e-6 epsilon, clamped to [0, count − 1]; non-finite picks 0. */
export function optionIndex(value: unknown, count: number): number {
  const n = typeof value === "number" ? value : typeof value === "boolean" ? (value ? 1 : 0) : Number.NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.floor(n + 1e-6), 0), count - 1);
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/** A duration input in seconds: negative is 0, and NaN or ±Infinity is 0 with one warning per restart. */
export function readDuration(ctx: PatchContext<any>, key: string, label: string): number {
  const { seconds, valid } = safeDuration(ctx.input(key));
  if (!valid) warnOnce(ctx, `${key}:nonFinite`, `${label} "${ctx.id}": ${key} isn't a finite number of seconds, so it counts as 0.`);
  return seconds;
}
