/**
 * Value helpers for patch evaluators: number and boolean reading, clamps, zero values
 * (CONVENTIONS.md §8), component access for variant ports, JSON conversion, and
 * structural equality.
 */

import { IDENTITY_TRANSFORM, coerce, formatColor, inferValueType, isColor, parseColor } from "@sonobe/core";
import type { Color, EnumOption, Value, ValueType } from "@sonobe/core";

/** True for non-null, non-array objects. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `value` when it's a finite number, else `fallback`. */
export function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Read any runtime value as a finite number (booleans 1/0, text parsed, vectors first component). */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (value === undefined || value === null) return fallback;
  return finiteOr(coerce(value as Value, inferValueType(value as Value), "number"), fallback);
}

/** Read any runtime value as a boolean (numbers `> 0`, "true"/"yes"/"on" text). */
export function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return false;
  return coerce(value as Value, inferValueType(value as Value), "boolean") === true;
}

/** Read any runtime value as text (numbers up to 6 decimals, colors as "#RRGGBBAA"). */
export function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return String(coerce(value as Value, inferValueType(value as Value), "text"));
}

/** Clamp into [min, max]. When min > max, min wins (like CSS `clamp()`). NaN returns min. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(value, max));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** `a − m·floor(a / m)`: the result has the sign of `m` (0 when m is 0). */
export function positiveMod(a: number, m: number): number {
  if (m === 0 || !Number.isFinite(m)) return 0;
  const r = a - m * Math.floor(a / m);
  return r === 0 ? 0 : r;
}

/** Floor with a 1e-6 epsilon so float noise like 2.9999999999999996 reads as 3; NaN when not finite. */
export function whole(value: number): number {
  return Number.isFinite(value) ? Math.floor(value + 1e-6) : Number.NaN;
}

/** {@link whole} clamped to [lo, hi]; non-finite values give `lo`. */
export function wholeInRange(value: number, lo: number, hi: number): number {
  return Number.isFinite(value) ? Math.min(hi, Math.max(lo, Math.floor(value + 1e-6))) : lo;
}

/** Map NaN and ±Infinity to 0 and -0 to 0. */
export function normalizeZero(value: number): number {
  return Number.isFinite(value) && value !== 0 ? value : 0;
}

// ---------------------------------------------------------------------------
// Zero values and components
// ---------------------------------------------------------------------------

const COMPONENT_COUNTS: Partial<Record<string, number>> = {
  number: 1,
  index: 1,
  boolean: 1,
  point: 2,
  size: 2,
  anchor: 2,
  point3d: 3,
  point4d: 4,
  color: 4,
};

/** Number of numeric components for a type (color = 4 RGBA channels); undefined for non-numeric types. */
export function componentCount(type: ValueType | string | undefined): number | undefined {
  return type === undefined ? undefined : COMPONENT_COUNTS[type];
}

/**
 * The zero value for a type (CONVENTIONS.md §8): 0, false, "", transparent black, zero vectors,
 * the first enum option, and null for json, media, gradient, shape, layerEffect, and layer.
 */
export function zeroValue(type: ValueType | string | undefined, enumOptions?: readonly EnumOption[]): Value {
  switch (type) {
    case "number":
    case "index":
      return 0;
    case "boolean":
    case "pulse":
      return false;
    case "text":
      return "";
    case "enum":
      return enumOptions?.[0]?.key ?? "";
    case "color":
      return { r: 0, g: 0, b: 0, a: 0 } satisfies Color;
    case "point":
    case "size":
    case "anchor":
      return [0, 0];
    case "point3d":
      return [0, 0, 0];
    case "point4d":
      return [0, 0, 0, 0];
    case "transform":
      return [...IDENTITY_TRANSFORM];
    case "textStyle":
      return {};
    default:
      return null;
  }
}

function inferComponentType(value: unknown): ValueType {
  if (isColor(value)) return "color";
  if (Array.isArray(value)) return value.length >= 4 ? "point4d" : value.length === 3 ? "point3d" : "point";
  return "number";
}

/**
 * A value as numeric components for `type`: numbers as [n], vectors resized (a number broadcasts),
 * colors as [r, g, b, a]. Non-finite components are kept, so callers can detect and warn.
 * Without a type, the shape of the value decides.
 */
export function components(value: unknown, type?: ValueType | string): number[] {
  const t = type !== undefined && COMPONENT_COUNTS[type] !== undefined ? (type as ValueType) : inferComponentType(value);
  if (t === "color") {
    const c = isColor(value) ? value : typeof value === "string" ? parseColor(value) : (coerce(value as Value, inferValueType(value as Value), "color") as Color);
    return c ? [c.r, c.g, c.b, c.a] : [0, 0, 0, 0];
  }
  const n = COMPONENT_COUNTS[t]!;
  if (n === 1) return [typeof value === "number" ? value : toNumber(value)];
  if (Array.isArray(value) && value.every((v) => typeof v === "number")) {
    return Array.from({ length: n }, (_, i) => (i < value.length ? (value[i] as number) : 0));
  }
  if (typeof value === "number") return new Array<number>(n).fill(value);
  return coerce(value as Value, inferValueType(value as Value), t) as number[];
}

/** Build a value of `type` from components: colors clamp each channel to 0–1, index floors at ≥ 0. */
export function fromComponents(values: readonly number[], type: ValueType | string): Value {
  switch (type) {
    case "number":
      return values[0] ?? 0;
    case "index":
      return Math.max(0, Math.floor(finiteOr(values[0], 0)));
    case "boolean":
      return (values[0] ?? 0) > 0;
    case "color":
      return { r: clamp01(values[0] ?? 0), g: clamp01(values[1] ?? 0), b: clamp01(values[2] ?? 0), a: clamp01(values[3] ?? 0) } satisfies Color;
    default: {
      const n = COMPONENT_COUNTS[type] ?? values.length;
      return Array.from({ length: n }, (_, i) => values[i] ?? 0);
    }
  }
}

/** Same length and every component `===`. */
export function sameComponents(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** True when every component is finite. */
export function allFinite(values: readonly number[]): boolean {
  for (const v of values) if (!Number.isFinite(v)) return false;
  return true;
}

export function zeros(length: number): number[] {
  return new Array<number>(Math.max(0, length)).fill(0);
}

// ---------------------------------------------------------------------------
// JSON and equality
// ---------------------------------------------------------------------------

const isLoopValue = (v: unknown): v is { __loop: true; items: readonly unknown[] } =>
  isPlainObject(v) && v.__loop === true && Array.isArray(v.items);

/**
 * Convert a runtime value into plain JSON: colors become "#RRGGBBAA", non-finite numbers 0
 * (reported through `onNonFinite`), undefined null, loops arrays; arrays and plain objects map
 * recursively and everything else passes through.
 */
export function toJson(value: unknown, onNonFinite?: () => void): unknown {
  if (value === undefined) return null;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    onNonFinite?.();
    return 0;
  }
  if (isColor(value)) return formatColor(value);
  if (isLoopValue(value)) return value.items.map((item) => toJson(item, onNonFinite));
  if (Array.isArray(value)) return value.map((item) => toJson(item, onNonFinite));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = toJson(v, onNonFinite);
    return out;
  }
  return value;
}

/**
 * Structural equality for runtime values: numbers with `===` (0 equals -0) and NaN equal to NaN,
 * arrays and loops item by item, plain objects key by key.
 */
export function equalValues(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!equalValues(a[i], b[i])) return false;
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) if (!Object.hasOwn(b, k) || !equalValues(a[k], b[k])) return false;
    return true;
  }
  return false;
}
