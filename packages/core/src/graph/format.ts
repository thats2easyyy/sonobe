/** Compact value formatting for port rows, cables, and hover cards. */

import { formatKnobValue } from "../knobs.ts";
import type { EnumOption, Knob, Value, ValueType } from "../types.ts";
import { formatColor, isColor } from "../values.ts";

export interface LoopLike {
  __loop: true;
  items: readonly unknown[];
}

export function isLoopValue(value: unknown): value is LoopLike {
  return !!value && typeof value === "object" && (value as { __loop?: unknown }).__loop === true && Array.isArray((value as { items?: unknown }).items);
}

/** Up to 3 decimals, no trailing zeros, thousands compacted past 6 digits. */
export function formatNumberShort(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : n < 0 ? "−∞" : "NaN";
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${trim((n / 1e6).toFixed(2))}M`;
  if (abs >= 1e5) return `${trim((n / 1e3).toFixed(1))}k`;
  const text = abs >= 100 ? n.toFixed(1) : abs >= 10 ? n.toFixed(2) : n.toFixed(3);
  const out = trim(text);
  return out === "-0" ? "0" : out;
}

const trim = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

/** "#FF375F" for opaque colors, "#FF375F80" otherwise. */
export function shortHex(color: { r: number; g: number; b: number; a: number }): string {
  const hex = formatColor(color);
  return hex.endsWith("FF") ? hex.slice(0, 7) : hex;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * What one watched copy reads from a value: item `copy` of a loop (wrapping, as a shorter loop
 * does when a patch runs per copy) with its index, or a plain value as it is (every copy reads it).
 * An empty loop has no item.
 */
export function pickCopy(value: unknown, copy: number): { value: unknown; index: number | null; empty: boolean } {
  if (!isLoopValue(value)) return { value, index: null, empty: false };
  const n = value.items.length;
  if (n === 0) return { value: undefined, index: null, empty: true };
  const index = copy % n;
  return { value: value.items[index], index, empty: false };
}

export interface FormatOptions {
  /** Max characters for text values. Default 14. */
  maxText?: number;
  /** The watched loop copy: a loop shows that item ("#3 0.52") instead of its "×N" summary. */
  copy?: number | null;
  enumOptions?: readonly EnumOption[];
  /** Layer id → layer name, for layer references. */
  layerName?: (id: string) => string | undefined;
}

/** A short, human label for a runtime value of `type`. */
export function formatValue(value: unknown, type: ValueType, options: FormatOptions = {}): string {
  const maxText = options.maxText ?? 14;
  if (isLoopValue(value)) {
    const { copy, ...plain } = options;
    if (copy !== undefined && copy !== null && value.items.length) {
      const picked = pickCopy(value, copy);
      return `#${picked.index} ${formatValue(picked.value, type, { ...plain, maxText: 8 })}`;
    }
    const first = value.items.length ? formatValue(value.items[0], type, { ...plain, maxText: 8 }) : "";
    return value.items.length ? `×${value.items.length} ${first}…` : "×0";
  }
  if (value === undefined || value === null) return "—";
  switch (type) {
    case "pulse":
      return value === true ? "Fired" : "";
    case "boolean":
      return value === true ? "On" : value === false ? "Off" : String(value);
    case "number":
    case "index":
      return typeof value === "number" ? formatNumberShort(value) : truncate(String(value), maxText);
    case "enum": {
      const key = String(value);
      return truncate(options.enumOptions?.find((o) => o.key === key)?.name ?? key, maxText);
    }
    case "color":
      if (isColor(value)) return shortHex(value);
      return typeof value === "string" ? value.slice(0, 9) : "—";
    case "text":
      return typeof value === "string" ? `“${truncate(value, maxText)}”` : truncate(String(value), maxText);
    case "layer": {
      const id = typeof value === "string" ? value : (value as { layerId?: unknown }).layerId;
      return typeof id === "string" ? truncate(options.layerName?.(id) ?? id, maxText) : "—";
    }
    case "image":
    case "video":
    case "sound": {
      const v = value as { assetId?: string; url?: string };
      return truncate(v.assetId ?? v.url ?? "—", maxText);
    }
    default:
      break;
  }
  if (Array.isArray(value)) {
    if (value.every((n) => typeof n === "number")) {
      if (value.length > 4) return `[${value.length}]`;
      return value.map((n) => formatNumberShort(n as number)).join(", ");
    }
    return `[${value.length}]`;
  }
  if (isColor(value)) return shortHex(value);
  if (typeof value === "number") return formatNumberShort(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return `“${truncate(value, maxText)}”`;
  if (typeof value === "object") return "{…}";
  return truncate(String(value), maxText);
}

/** The longest text formatNumberShort prints for a number under a trillion: "-99999.9", "-999.99M". */
export const NUMBER_SHORT_CHARS = 8;

const digits = (n: number) => String(Math.max(0, Math.trunc(n))).length;

/** The longest text formatValue's default branch prints for a value of this kind (json and any ports). */
function kindReserve(value: unknown, maxText: number): number {
  if (value === undefined || value === null) return 1;
  if (Array.isArray(value)) {
    if (value.length <= 4 && value.every((n) => typeof n === "number")) return value.length * NUMBER_SHORT_CHARS + Math.max(0, value.length - 1) * 2;
    return Math.max(5, 2 + digits(value.length));
  }
  if (isColor(value)) return 9;
  if (typeof value === "number") return NUMBER_SHORT_CHARS;
  if (typeof value === "boolean") return 5;
  if (typeof value === "string") return maxText + 2;
  if (typeof value === "object") return 3;
  return maxText;
}

/** The longest text formatValue prints for one (non-loop) value of `type`. */
function plainReserve(value: unknown, type: ValueType, maxText: number, enumOptions?: readonly EnumOption[]): number {
  switch (type) {
    case "pulse":
      return 5;
    case "boolean":
      return 3;
    case "number":
    case "index":
      return typeof value === "number" || value === undefined || value === null ? NUMBER_SHORT_CHARS : maxText;
    case "enum": {
      if (!enumOptions?.length) return maxText;
      const known = enumOptions.some((o) => o.key === value);
      const names = [...enumOptions.map((o) => o.name.length), known || value === undefined || value === null ? 0 : String(value).length];
      return Math.min(maxText, Math.max(...names));
    }
    case "color":
      return 9;
    case "text":
      return typeof value === "string" || value === undefined || value === null ? maxText + 2 : maxText;
    case "layer":
    case "image":
    case "video":
    case "sound":
      return maxText;
    default:
      return kindReserve(value, maxText);
  }
}

/**
 * The most characters formatValue(value, type, options) prints while the value changes: the longest
 * text of the port's type (8 for numbers, "Off", "#RRGGBBAA", quotes around maxText characters, the
 * longest enum option), or of the value's own kind for json and any. A loop reserves its "×N" summary
 * around one item, or the watched copy's "#k " prefix, for its current length (an empty loop as a
 * one-digit loop). Output rows keep this much room for their live values (liveReserve), so a node
 * keeps its width while the prototype runs. 0 when nothing prints (no value, or a pulse).
 */
export function formatValueReserve(value: unknown, type: ValueType, options: FormatOptions = {}): number {
  if (value === undefined || type === "pulse") return 0;
  const maxText = options.maxText ?? 14;
  if (!isLoopValue(value)) return plainReserve(value, type, maxText, options.enumOptions);
  const n = value.items.length;
  if (options.copy !== undefined && options.copy !== null && n) {
    const picked = pickCopy(value, options.copy);
    return 1 + digits(n - 1) + 1 + plainReserve(picked.value, type, 8, options.enumOptions);
  }
  return 1 + digits(n) + 1 + plainReserve(value.items[0], type, 8, options.enumOptions) + 1;
}

/** Decimal places in a step: 0.05 → 2, 1e-7 → 7, 5 → 0 (at most 6, like the knob fields). */
function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || Number.isInteger(step)) return 0;
  const [mantissa = "", exponent] = Math.abs(step).toString().split("e");
  const dot = mantissa.indexOf(".");
  return Math.min(6, Math.max(0, (dot === -1 ? 0 : mantissa.length - dot - 1) - Number(exponent ?? 0)));
}

/** The most a knob chip keeps for its value, so the knob's name keeps room in the 110 pt chip. */
export const KNOB_RESERVE_MAX_CHARS = 7;

/**
 * The characters a knob chip keeps for its value text (formatKnobValue) while the knob is tuned in
 * the Knobs tab: a number knob's slider reaches its longer end at the slider's step precision (its
 * step, or a hundredth of the range), unit included; a boolean flips between "on" and "off". At
 * most KNOB_RESERVE_MAX_CHARS. Values picked from a menu or typed (enums, points, text, numbers
 * without a range) reserve nothing past their text.
 */
export function knobValueReserve(knob: Pick<Knob, "type" | "min" | "max" | "step" | "unit">): number {
  if (knob.type === "boolean") return 3;
  if (knob.type !== "number") return 0;
  const { min, max } = knob;
  if (min === undefined || max === undefined || !(max > min)) return 0;
  const decimals = stepDecimals(knob.step !== undefined && knob.step > 0 ? knob.step : (max - min) / 100);
  const end = (n: number) => (n < 0 ? 1 : 0) + digits(Math.abs(n));
  // formatKnobValue's unit suffix (" pt", "°") is what it adds to a bare "0".
  const unit = formatKnobValue(knob, 0).length - 1;
  return Math.min(KNOB_RESERVE_MAX_CHARS, Math.max(end(min), end(max)) + (decimals ? decimals + 1 : 0) + unit);
}

/** Longer multi-line text for hover cards. */
export function formatValueLong(value: unknown, type: ValueType, options: FormatOptions = {}): string {
  if (isLoopValue(value)) {
    const { copy, ...plain } = options;
    if (copy !== undefined && copy !== null && value.items.length) {
      const picked = pickCopy(value, copy);
      return `Copy #${picked.index} of ${value.items.length}: ${formatValue(picked.value, type, { ...plain, maxText: 40 })}`;
    }
    const items = value.items.slice(0, 8).map((item) => formatValue(item, type, { ...plain, maxText: 40 }));
    return `Loop of ${value.items.length}: ${items.join(" · ")}${value.items.length > 8 ? " …" : ""}`;
  }
  if (type === "json" || (value && typeof value === "object" && !Array.isArray(value) && !isColor(value))) {
    try {
      const text = JSON.stringify(value, null, 1) ?? "—";
      return text.length > 160 ? `${text.slice(0, 159)}…` : text;
    } catch {
      return "—";
    }
  }
  return formatValue(value, type, { ...options, maxText: 60 });
}

/** True when a value should glow: a true boolean, a fired pulse, or a loop with any true item. */
export function isTruthyState(value: unknown): boolean {
  if (value === true) return true;
  return isLoopValue(value) && value.items.some((v) => v === true);
}

/** The loop length of a live value, when it's a loop. */
export function loopLengthOf(value: Value | LoopLike | undefined): number | undefined {
  return isLoopValue(value) ? value.items.length : undefined;
}
