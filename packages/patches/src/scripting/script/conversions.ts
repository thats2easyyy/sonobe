/**
 * Value conversions for the javascript patch: engine values become plain script data (always
 * copies), and script values are checked and converted back to the declared port type.
 */

import { IDENTITY_TRANSFORM, parseColor } from "@sonobe/core";
import type { AssetRef, Color, EnumOption, GradientValue, LayerEffectValue, LayerRef, TextStyleValue, Value, ValueType } from "@sonobe/core";
import type { RuntimeServices } from "@sonobe/engine";
import { callValue, getProp, isObjectLike } from "../sandbox/realm.ts";

/** Returned when a script value can't become the port type. */
export const REJECTED: unique symbol = Symbol("rejected");
export type Converted = Value | typeof REJECTED;

const VECTOR_LENGTHS: Partial<Record<ValueType, number>> = { point: 2, size: 2, anchor: 2, point3d: 3, point4d: 4 };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepCopy(value: unknown, depth = 0): unknown {
  if (value === undefined) return null;
  if (typeof value !== "object" || value === null) return value;
  if (depth > 64) return null;
  if (Array.isArray(value)) return value.map((item) => deepCopy(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = deepCopy(item, depth + 1);
  return out;
}

/** An engine value of `type` as a fresh script value. */
export function toScriptValue(value: unknown, type: ValueType, services: Pick<RuntimeServices, "resolveAssetUrl">): unknown {
  switch (type) {
    case "number":
    case "index":
      return typeof value === "number" ? value : Number(value) || 0;
    case "boolean":
    case "pulse":
      return value === true;
    case "text":
    case "enum":
      return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
    case "json":
      return deepCopy(value);
    case "color": {
      const c = value as Partial<Color> | null;
      return isPlainRecord(c) ? { r: Number(c.r) || 0, g: Number(c.g) || 0, b: Number(c.b) || 0, a: Number(c.a) || 0 } : { r: 0, g: 0, b: 0, a: 0 };
    }
    case "point":
    case "size":
    case "anchor":
    case "point3d":
    case "point4d":
    case "transform":
      return Array.isArray(value) ? value.map((n) => Number(n) || 0) : [];
    case "layer": {
      const ref = value as Partial<LayerRef> | null;
      if (!isPlainRecord(ref) || typeof ref.layerId !== "string") return null;
      return typeof ref.instance === "number" ? { layerId: ref.layerId, instance: ref.instance } : { layerId: ref.layerId };
    }
    case "image":
    case "video":
    case "sound": {
      const asset = value as Partial<AssetRef> | null;
      if (!isPlainRecord(asset)) return null;
      const out: { assetId?: string; url?: string } = {};
      if (typeof asset.assetId === "string") {
        out.assetId = asset.assetId;
        const url = services.resolveAssetUrl(asset.assetId);
        if (url !== undefined) out.url = url;
      } else if (typeof asset.url === "string") out.url = asset.url;
      return out.assetId !== undefined || out.url !== undefined ? out : null;
    }
    default:
      return value === undefined || value === null ? null : deepCopy(value);
  }
}

/** The value `null` becomes for a type: zero values for value types, null for references and media. */
function nullValue(type: ValueType, enumOptions?: readonly EnumOption[]): Value {
  switch (type) {
    case "number":
    case "index":
      return 0;
    case "boolean":
      return false;
    case "text":
      return "";
    case "enum":
      return enumOptions?.[0]?.key ?? "";
    case "color":
      return { r: 0, g: 0, b: 0, a: 0 };
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
    default:
      return null;
  }
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function toFiniteNumber(value: unknown): Converted {
  if (typeof value === "number") return Number.isFinite(value) ? value : REJECTED;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : REJECTED;
  }
  return REJECTED;
}

function toText(value: unknown): Converted {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (isObjectLike(value) && typeof value !== "function") {
    try {
      const text = JSON.stringify(value);
      return typeof text === "string" ? text : REJECTED;
    } catch {
      return REJECTED;
    }
  }
  return REJECTED;
}

function jsonData(value: unknown, stack: object[]): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : REJECTED;
  if (!isObjectLike(value) || typeof value === "function") return REJECTED;
  const toJSON = getProp(value, "toJSON");
  if (typeof toJSON === "function") {
    if (stack.length > 64) return REJECTED;
    stack.push(value);
    const result = jsonData(callValue(toJSON, value, [""]), stack);
    stack.pop();
    return result;
  }
  if (stack.includes(value) || stack.length > 64) return REJECTED;
  stack.push(value);
  try {
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        const item = getProp(value, i);
        if (item === undefined || typeof item === "function" || typeof item === "symbol") out.push(null);
        else {
          const converted = jsonData(item, stack);
          if (converted === REJECTED) return REJECTED;
          out.push(converted);
        }
      }
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const item = getProp(value, key);
      if (item === undefined || typeof item === "function" || typeof item === "symbol") continue;
      const converted = jsonData(item, stack);
      if (converted === REJECTED) return REJECTED;
      out[key] = converted;
    }
    return out;
  } finally {
    stack.pop();
  }
}

function toColor(value: unknown): Color | typeof REJECTED {
  if (typeof value === "string") {
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim())) return REJECTED;
    return parseColor(value) ?? REJECTED;
  }
  if (!isObjectLike(value)) return REJECTED;
  const r = getProp(value, "r");
  const g = getProp(value, "g");
  const b = getProp(value, "b");
  const rawA = getProp(value, "a");
  const a = rawA === undefined ? 1 : rawA;
  if (!finite(r) || !finite(g) || !finite(b) || !finite(a)) return REJECTED;
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b), a: clamp01(a) };
}

function toVector(value: unknown, type: ValueType, length: number): Converted {
  if (typeof value === "number") return Number.isFinite(value) ? new Array<number>(length).fill(value) : REJECTED;
  if (Array.isArray(value)) {
    if (value.length !== length) return REJECTED;
    const out = value.map((n) => n as unknown);
    return out.every(finite) ? (out as number[]) : REJECTED;
  }
  if (!isObjectLike(value)) return REJECTED;
  if (type === "size" && getProp(value, "width") !== undefined) {
    const w = getProp(value, "width");
    const h = getProp(value, "height");
    return finite(w) && finite(h) ? [w, h] : REJECTED;
  }
  const keys = ["x", "y", "z", "w"].slice(0, length);
  const out = keys.map((k, i) => {
    const v = getProp(value, k);
    return v === undefined && i >= 2 ? 0 : v;
  });
  return out.every(finite) ? (out as number[]) : REJECTED;
}

function toPoint2(value: unknown, fallback: [number, number]): [number, number] | typeof REJECTED {
  if (value === undefined) return fallback;
  const v = toVector(value, "point", 2);
  return v === REJECTED ? REJECTED : (v as [number, number]);
}

function toGradient(value: unknown): Converted {
  if (!isObjectLike(value)) return REJECTED;
  const kind = getProp(value, "kind");
  if (kind !== "linear" && kind !== "radial" && kind !== "angular") return REJECTED;
  const rawStops = getProp(value, "stops");
  if (!Array.isArray(rawStops)) return REJECTED;
  const stops: GradientValue["stops"] = [];
  for (const stop of rawStops) {
    if (!isObjectLike(stop)) return REJECTED;
    const offset = getProp(stop, "offset");
    const color = toColor(getProp(stop, "color"));
    if (!finite(offset) || color === REJECTED) return REJECTED;
    stops.push({ offset, color });
  }
  const start = toPoint2(getProp(value, "start"), [0.5, 0]);
  const end = toPoint2(getProp(value, "end"), [0.5, 1]);
  if (start === REJECTED || end === REJECTED) return REJECTED;
  return { kind, stops, start, end } satisfies GradientValue;
}

function toLayerEffect(value: unknown): Converted {
  if (!isObjectLike(value)) return REJECTED;
  const kind = getProp(value, "kind");
  if (typeof kind !== "string") return REJECTED;
  const rawParams = getProp(value, "params");
  const params: LayerEffectValue["params"] = {};
  if (rawParams !== undefined) {
    if (!isObjectLike(rawParams)) return REJECTED;
    for (const key of Object.keys(rawParams)) {
      const v = getProp(rawParams, key);
      if (finite(v) || typeof v === "boolean" || typeof v === "string") params[key] = v;
      else {
        const color = toColor(v);
        if (color === REJECTED) return REJECTED;
        params[key] = color;
      }
    }
  }
  return { kind, params } satisfies LayerEffectValue;
}

const TEXT_STYLE_FIELDS: Readonly<Record<string, (v: unknown) => unknown>> = {
  fontFamily: (v) => (typeof v === "string" ? v : REJECTED),
  fontSize: (v) => (finite(v) ? v : REJECTED),
  fontWeight: (v) => (finite(v) ? v : REJECTED),
  italic: (v) => (typeof v === "boolean" ? v : REJECTED),
  color: (v) => toColor(v),
  letterSpacing: (v) => (finite(v) ? v : REJECTED),
  lineHeight: (v) => (finite(v) ? v : REJECTED),
  alignment: (v) => (v === "left" || v === "center" || v === "right" || v === "justify" ? v : REJECTED),
  decoration: (v) => (v === "none" || v === "underline" || v === "strikethrough" ? v : REJECTED),
  transform: (v) => (v === "none" || v === "uppercase" || v === "lowercase" || v === "capitalize" ? v : REJECTED),
};

function toTextStyle(value: unknown): Converted {
  if (!isObjectLike(value)) return REJECTED;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const check = TEXT_STYLE_FIELDS[key];
    if (!check) return REJECTED;
    const v = getProp(value, key);
    if (v === undefined) continue;
    const converted = check(v);
    if (converted === REJECTED) return REJECTED;
    out[key] = converted;
  }
  return out as TextStyleValue;
}

/** A script value as an engine value of `type`, or REJECTED. */
export function fromScriptValue(value: unknown, type: ValueType, enumOptions?: readonly EnumOption[]): Converted {
  if (value === undefined) return REJECTED;
  if (value === null) return nullValue(type, enumOptions);
  switch (type) {
    case "number":
      return toFiniteNumber(value);
    case "index": {
      const n = toFiniteNumber(value);
      return n === REJECTED ? n : Math.max(0, Math.trunc(n as number));
    }
    case "boolean":
    case "pulse":
      return Boolean(value);
    case "text":
      return toText(value);
    case "enum":
      return typeof value === "string" && (enumOptions ?? []).some((o) => o.key === value) ? value : REJECTED;
    case "json": {
      const data = jsonData(value, []);
      return data === REJECTED ? REJECTED : (data as Value);
    }
    case "color":
      return toColor(value);
    case "point":
    case "size":
    case "anchor":
    case "point3d":
    case "point4d":
      return toVector(value, type, VECTOR_LENGTHS[type]!);
    case "transform":
      return Array.isArray(value) && value.length === 16 && value.every(finite) ? [...(value as number[])] : REJECTED;
    case "layer": {
      if (typeof value === "string") return value ? ({ layerId: value } satisfies LayerRef) : REJECTED;
      if (!isObjectLike(value)) return REJECTED;
      const layerId = getProp(value, "layerId");
      const instance = getProp(value, "instance");
      if (typeof layerId !== "string") return REJECTED;
      if (instance === undefined) return { layerId } satisfies LayerRef;
      return finite(instance) && Number.isInteger(instance) && instance >= 0 ? ({ layerId, instance } satisfies LayerRef) : REJECTED;
    }
    case "image":
    case "video":
    case "sound": {
      if (typeof value === "string") return { url: value } satisfies AssetRef;
      if (!isObjectLike(value)) return REJECTED;
      const assetId = getProp(value, "assetId");
      if (typeof assetId === "string") return { assetId } satisfies AssetRef;
      const url = getProp(value, "url");
      return typeof url === "string" ? ({ url } satisfies AssetRef) : REJECTED;
    }
    case "shape": {
      if (typeof value === "string") return { path: value };
      if (!isObjectLike(value)) return REJECTED;
      const path = getProp(value, "path");
      return typeof path === "string" ? { path } : REJECTED;
    }
    case "gradient":
      return toGradient(value);
    case "layerEffect":
      return toLayerEffect(value);
    case "textStyle":
      return toTextStyle(value);
    default:
      return REJECTED;
  }
}

/** A short preview of a script value for warnings. */
export function previewValue(value: unknown): string {
  let text: string;
  if (typeof value === "string") text = JSON.stringify(value);
  else if (typeof value === "function") text = "a function";
  else if (typeof value === "symbol") text = value.toString();
  else if (typeof value === "bigint") text = `${value}n`;
  else if (value === undefined) text = "undefined";
  else if (typeof value === "object" && value !== null) {
    try {
      text = JSON.stringify(value) ?? (Array.isArray(value) ? "an array" : "an object");
    } catch {
      text = Array.isArray(value) ? "an array" : "an object";
    }
  } else text = String(value);
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}
