/** Runtime value helpers: equality, zero values, loop-aware coercion, and decoding stored literals. */

import {
  coerce,
  decodeInput,
  decodeLiteral,
  defaultValue,
  inferValueType,
  isDecodedLoop,
  isGradientLiteral,
  isLiteral,
  isLoopLiteral,
  type EnumOption,
  type InputValue,
  type Value,
  type ValueType,
} from "@sonobe/core";
import type { Loop } from "../types.ts";
import { isLoop, makeLoop } from "./loop.ts";

/** Deep structural equality for runtime values (numbers compare with NaN equal to NaN). */
export function valuesEqual(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (depth > 16) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!valuesEqual(a[i], b[i], depth + 1)) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!valuesEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth + 1)) return false;
  }
  return true;
}

/**
 * Zero value of a type (CONVENTIONS.md §8): what muted patches, unresolved variables and
 * unconnected published outputs emit. Colors are transparent; enums take their first option.
 */
export function zeroValue(type: ValueType, enumOptions?: readonly EnumOption[]): Value {
  if (type === "color") return { r: 0, g: 0, b: 0, a: 0 };
  if (type === "enum") return enumOptions?.[0]?.key ?? "";
  return defaultValue(type);
}

/** On/off reading of a value for pulses and rising edges (numbers > 0 are on). */
export function truthy(value: unknown): boolean {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  if (typeof value === "number") return value > 0;
  return coerce(value, inferValueType(value), "boolean") === true;
}

/** Coerce a value (or every item of a loop) from `from` to `to` (ARCHITECTURE.md §4). */
export function coerceValue(value: Value | Loop, from: ValueType, to: ValueType): Value | Loop {
  if (to === "any" || (from === to && from !== "json")) return value;
  if (isLoop(value)) {
    const items = new Array<Value>(value.items.length);
    for (let i = 0; i < items.length; i++) items[i] = coerce(value.items[i], from, to);
    return makeLoop(items);
  }
  return coerce(value, from, to);
}

/**
 * Normalize a declared default (a spec literal like "#FFFFFFFF", `{ "loop": [] }`, or a runtime
 * object) into a runtime value of `type`. Undefined stays undefined.
 */
export function normalizeDefault(value: unknown, type: ValueType): Value | Loop | undefined {
  if (value === undefined) return undefined;
  if (isLoop(value)) return value;
  if (isLoopLiteral(value)) return makeLoop(value.loop.map((item) => decodeLiteral(item, type)));
  if (isGradientLiteral(value)) return decodeInput(value, type) as Value;
  if (isLiteral(value)) return decodeLiteral(value, type);
  return value;
}

/** Decode a stored non-link input value (literal, asset, json, gradient, loop literal) for a port of `type`. */
export function decodeStored(input: InputValue, type: ValueType): Value | Loop {
  const decoded = decodeInput(input, type);
  if (isDecodedLoop(decoded)) return makeLoop(decoded.items);
  return decoded as Value;
}
