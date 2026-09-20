/** Compact value formatting for port rows, cables, and hover cards. */

import { formatKnobValue } from "../knobs.ts";
import type { EnumOption, Knob, Value, ValueSubtype, ValueType } from "../types.ts";
import { formatColor, isColor } from "../values.ts";

export interface LoopLike {
  __loop: true;
  items: readonly unknown[];
}

export function isLoopValue(value: unknown): value is LoopLike {
  return !!value && typeof value === "object" && (value as { __loop?: unknown }).__loop === true && Array.isArray((value as { items?: unknown }).items);
}

/** Up to 3 decimals, no trailing zeros, compacted past 6 digits ("123.5k", "1.25M", "-4.2B", "3T"). */
export function formatNumberShort(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : n < 0 ? "−∞" : "NaN";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${trim((n / 1e12).toFixed(2))}T`;
  if (abs >= 1e9) return `${trim((n / 1e9).toFixed(2))}B`;
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

/** The longest text formatNumberShort prints for a number under a quadrillion (10^15): "-99999.9", "-999.99M", "-999.99T". */
export const NUMBER_SHORT_CHARS = 8;

/**
 * What a number keeps when its port says what it measures: a progress stays within ±10 ("-0.125",
 * "1.052" past a spring's overshoot), an angle within ±1000° ("-179.9"), and an index counts items
 * or frames (loops stop at 10,000 items; "123.4k" frames is half an hour). Other numbers keep
 * NUMBER_SHORT_CHARS.
 */
const SHORT_NUMBER_CHARS = 6;

/**
 * What a point's coordinate keeps: "-999.9", any position on a screen. A point's reserve is these
 * with ", " between them ("-999.9, -999.9").
 */
export const COORDINATE_CHARS = 6;

/**
 * What a loop's "×N" summary keeps for its first item, which it shows as a preview before "…"
 * ("×12 0…", "×3 -0.25…"): a longer item ends early, and the hover card has the whole loop.
 */
export const LOOP_PREVIEW_CHARS = 6;

const AXES: Partial<Record<ValueType, number>> = { point: 2, size: 2, anchor: 2, point3d: 3, point4d: 4 };

const digits = (n: number) => String(Math.max(0, Math.trunc(n))).length;

/** A loop's count ("×12") and a watched copy's index ("#3") keep two digits, so loops of up to 99 print in full as they grow. */
const countDigits = (n: number) => Math.max(2, digits(n));

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

export interface ReserveOptions extends FormatOptions {
  /** What the port's numbers measure: a progress or an angle keeps less room than a number that can be anything. */
  subtype?: ValueSubtype;
}

/** The longest text formatValue prints for one (non-loop) value of `type`. */
function plainReserve(value: unknown, type: ValueType, maxText: number, options: ReserveOptions): number {
  switch (type) {
    case "pulse":
      return 5;
    case "boolean":
      return 3;
    case "number":
    case "index": {
      if (typeof value !== "number" && value !== undefined && value !== null) return maxText;
      const short = type === "index" || options.subtype === "progress" || options.subtype === "angle";
      return short ? SHORT_NUMBER_CHARS : NUMBER_SHORT_CHARS;
    }
    case "enum": {
      const enumOptions = options.enumOptions;
      if (!enumOptions?.length) return maxText;
      const known = enumOptions.some((o) => o.key === value);
      const names = [...enumOptions.map((o) => o.name.length), known || value === undefined || value === null ? 0 : String(value).length];
      return Math.min(maxText, Math.max(...names));
    }
    case "color":
      return 9;
    case "point":
    case "size":
    case "anchor":
    case "point3d":
    case "point4d": {
      const numbers = value === undefined || value === null || (Array.isArray(value) && value.length <= 4 && value.every((n) => typeof n === "number"));
      if (!numbers) return kindReserve(value, maxText);
      const axes = AXES[type]!;
      return axes * COORDINATE_CHARS + (axes - 1) * 2;
    }
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
 * The characters an output keeps for formatValue(value, type, options) whatever the value is on this
 * frame: the longest text of the port's type (8 for a number, 6 for a progress, an angle or an
 * index, "Off", "#RRGGBBAA", quotes around maxText characters, the longest enum option, a point's
 * coordinates to ±999.9), or of the value's own kind for json and any. A loop keeps its "×N"
 * summary with a short preview of its first item (LOOP_PREVIEW_CHARS), or the watched copy's "#k "
 * and the whole item, with at least two digits for the count. The patch editor draws live values in
 * slots this wide (liveReserve), so a node keeps its width while the prototype runs; a value that
 * prints longer ends in "…". 0 when nothing prints (no value, or a pulse).
 */
export function formatValueReserve(value: unknown, type: ValueType, options: ReserveOptions = {}): number {
  if (value === undefined || type === "pulse") return 0;
  const maxText = options.maxText ?? 14;
  if (!isLoopValue(value)) return plainReserve(value, type, maxText, options);
  const n = value.items.length;
  // A watched copy of an empty loop prints "×0", which the copy's own reserve covers, so emptying the loop keeps the width.
  if (options.copy !== undefined && options.copy !== null) return 1 + countDigits(n - 1) + 1 + plainReserve(n ? pickCopy(value, options.copy).value : undefined, type, 8, options);
  return 1 + countDigits(n) + 1 + Math.min(LOOP_PREVIEW_CHARS, plainReserve(value.items[0], type, 8, options)) + 1;
}

/**
 * Decimal places in a number's shortest form, at most 6: 0.05 → 2, 1e-7 → 6, 5 → 0. The same count
 * as decimalsOf in the editor's scrubMath.ts, which the Slider snaps with.
 */
function decimalsOf(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0;
  const [mantissa = "", exponent] = Math.abs(n).toString().split("e");
  const dot = mantissa.indexOf(".");
  return Math.min(6, Math.max(0, (dot === -1 ? 0 : mantissa.length - dot - 1) - Number(exponent ?? 0)));
}

/** What a number or a point's axis keeps without a range to reach: "-999", or "9999", past which scrubbing ends in a longer number. */
const UNRANGED_KNOB_CHARS = 4;

/**
 * The characters one number (or a point's axis) of a knob prints while it's tuned: with a range, the
 * longer end at the precision it snaps to (its step's or its min's decimals, whichever has more; a
 * number knob's slider takes a hundredth of the range for a missing step); without one, the
 * UNRANGED_KNOB_CHARS its field scrubs through in whole steps.
 */
function knobNumberChars(knob: Pick<Knob, "type" | "min" | "max" | "step">): number {
  const { min, max } = knob;
  const ranged = min !== undefined && max !== undefined && max > min;
  const step = knob.step !== undefined && knob.step > 0 ? knob.step : ranged && knob.type === "number" ? (max - min) / 100 : 1;
  // The Slider snaps from min to at most 6 places, which drops a step's float noise ((0.4 - 0.1) / 100 → 0.003).
  const rounded = Number(step.toFixed(6));
  const decimals = Math.max(rounded > 0 ? decimalsOf(rounded) : 6, min !== undefined ? decimalsOf(min) : 0);
  const end = (n: number) => (n < 0 ? 1 : 0) + digits(Math.abs(n));
  return (ranged ? Math.max(end(min), end(max)) : UNRANGED_KNOB_CHARS) + (decimals ? decimals + 1 : 0);
}

/**
 * The characters a knob chip keeps for its value text (formatKnobValue) while the knob is tuned in
 * the Knobs tab, unit included: a number knob's slider or field (knobNumberChars), a point knob's
 * two fields with ", " between them, a boolean's "off", an enum's longest option. Text and colors
 * reserve nothing (a color knob shows a swatch). A value typed or fine-tuned past these can still
 * print longer. The patch editor gives it less when the knob's name needs the room (knobValueRoom).
 */
export function knobValueReserve(knob: Pick<Knob, "type" | "min" | "max" | "step" | "unit" | "options">): number {
  // formatKnobValue's unit suffix (" pt", "°") is what it adds to a bare "0".
  const unit = formatKnobValue({ type: "number", ...(knob.unit ? { unit: knob.unit } : {}) }, 0).length - 1;
  switch (knob.type) {
    case "boolean":
      return 3;
    case "enum":
      return Math.max(0, ...(knob.options ?? []).map((o) => o.name.length));
    case "number":
      return knobNumberChars(knob) + unit;
    case "point":
      return 2 * knobNumberChars(knob) + 2 + unit;
    default:
      return 0;
  }
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
