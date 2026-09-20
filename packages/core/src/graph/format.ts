/** Compact value formatting for port rows, cables, and hover cards. */

import type { EnumOption, Value, ValueType } from "../types.ts";
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
