/**
 * Values: color parsing/formatting, default runtime values, decoding document
 * literals into runtime values, encoding runtime values back into literals,
 * coercion between value types, and connection compatibility (ARCHITECTURE §3.3, §4).
 */

import type {
  AssetRef,
  Color,
  GradientLiteral,
  GradientValue,
  InputValue,
  LayerRef,
  Literal,
  SonobeDocument,
  Value,
  ValueType,
} from "./types.ts";

/** Every value type, in contract order. */
export const VALUE_TYPES: readonly ValueType[] = [
  "number", "boolean", "pulse", "text", "color", "point", "point3d", "point4d", "size", "anchor", "index",
  "enum", "json", "layer", "image", "video", "sound", "gradient", "shape", "textStyle", "layerEffect", "transform", "any",
];

const VALUE_TYPE_SET: ReadonlySet<string> = new Set(VALUE_TYPES);

export function isValueType(value: unknown): value is ValueType {
  return typeof value === "string" && VALUE_TYPE_SET.has(value);
}

const VECTOR_SIZES: Partial<Record<ValueType, number>> = { point: 2, size: 2, anchor: 2, point3d: 3, point4d: 4 };

/** Number of components for vector types (point, size, anchor, point3d, point4d); undefined otherwise. */
export function vectorSize(type: ValueType): number | undefined {
  return VECTOR_SIZES[type];
}

/** Types whose "nothing" value is `null` at runtime. */
const NULLABLE_TYPES: ReadonlySet<ValueType> = new Set(["json", "layer", "image", "video", "sound", "gradient", "shape", "layerEffect", "any"]);

export function isNullableType(type: ValueType): boolean {
  return NULLABLE_TYPES.has(type);
}

export const IDENTITY_TRANSFORM: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** Round to `decimals` places, mapping -0 to 0 and non-finite values to 0. */
export function roundNumber(n: number, decimals = 6): number {
  if (!Number.isFinite(n)) return 0;
  if (Math.abs(n) >= 1e15) return n;
  const f = 10 ** decimals;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Human/text formatting for numbers: up to 6 decimals, no trailing zeros, no -0. */
export function formatNumber(n: number): string {
  return String(roundNumber(n));
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const NAMED_COLORS: Record<string, string> = {
  transparent: "#00000000",
  black: "#000000FF",
  white: "#FFFFFFFF",
  red: "#FF3B30FF",
  orange: "#FF9500FF",
  yellow: "#FFCC00FF",
  green: "#34C759FF",
  blue: "#007AFFFF",
  purple: "#AF52DEFF",
  pink: "#FF2D55FF",
  gray: "#8E8E93FF",
  grey: "#8E8E93FF",
};

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function parseChannel(part: string, scale: number): number | undefined {
  const pct = part.endsWith("%");
  const n = Number(pct ? part.slice(0, -1) : part);
  if (!Number.isFinite(n) || part === "") return undefined;
  return clamp01(pct ? n / 100 : n / scale);
}

/**
 * Parse "#RGB", "#RGBA", "#RRGGBB", "#RRGGBBAA", "rgb()/rgba()" (0–255 channels or
 * percentages, alpha 0–1 or percentage), or a few common names ("white", "transparent").
 * Returns undefined when the text isn't a color.
 */
export function parseColor(input: string): Color | undefined {
  const s = input.trim();
  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (!/^[0-9a-fA-F]+$/.test(hex)) return undefined;
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
    if (hex.length === 6) hex += "FF";
    if (hex.length !== 8) return undefined;
    const byte = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
    return { r: byte(0), g: byte(2), b: byte(4), a: byte(6) };
  }
  const fn = /^rgba?\((.*)\)$/i.exec(s);
  if (fn) {
    const parts = fn[1]!.trim().split(/[\s,/]+/).filter(Boolean);
    if (parts.length !== 3 && parts.length !== 4) return undefined;
    const r = parseChannel(parts[0]!, 255);
    const g = parseChannel(parts[1]!, 255);
    const b = parseChannel(parts[2]!, 255);
    const a = parts.length === 4 ? parseChannel(parts[3]!, 1) : 1;
    if (r === undefined || g === undefined || b === undefined || a === undefined) return undefined;
    return { r, g, b, a };
  }
  const named = NAMED_COLORS[s.toLowerCase()];
  return named ? parseColor(named) : undefined;
}

const hexByte = (n: number) => Math.round(clamp01(Number.isFinite(n) ? n : 0) * 255).toString(16).toUpperCase().padStart(2, "0");

/** Format a runtime color as the canonical "#RRGGBBAA" literal. */
export function formatColor(color: Color): string {
  return `#${hexByte(color.r)}${hexByte(color.g)}${hexByte(color.b)}${hexByte(color.a)}`;
}

/** Normalize any parseable color text to "#RRGGBBAA"; undefined if it isn't a color. */
export function normalizeColor(input: string): string | undefined {
  const c = parseColor(input);
  return c ? formatColor(c) : undefined;
}

export function isColor(value: unknown): value is Color {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.r === "number" && typeof v.g === "number" && typeof v.b === "number" && typeof v.a === "number";
}

// ---------------------------------------------------------------------------
// Input value guards
// ---------------------------------------------------------------------------

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const hasOnlyKey = (v: unknown, key: string): boolean => isPlainObject(v) && key in v && Object.keys(v).length === 1;

export function isLinkInput(v: unknown): v is { link: string } {
  return hasOnlyKey(v, "link") && typeof (v as { link: unknown }).link === "string";
}
export function isLayerInput(v: unknown): v is { layer: string } {
  return hasOnlyKey(v, "layer") && typeof (v as { layer: unknown }).layer === "string";
}
export function isAssetInput(v: unknown): v is { asset: string } {
  return hasOnlyKey(v, "asset") && typeof (v as { asset: unknown }).asset === "string";
}
export function isLoopLiteral(v: unknown): v is { loop: Literal[] } {
  return hasOnlyKey(v, "loop") && Array.isArray((v as { loop: unknown }).loop);
}
export function isJsonLiteral(v: unknown): v is { json: unknown } {
  return hasOnlyKey(v, "json");
}
export function isGradientLiteral(v: unknown): v is GradientLiteral {
  return hasOnlyKey(v, "gradient") && isPlainObject((v as { gradient: unknown }).gradient);
}
/** number, boolean, string, number[] or null. */
export function isLiteral(v: unknown): v is Literal {
  if (v === null || typeof v === "boolean" || typeof v === "string") return true;
  if (typeof v === "number") return Number.isFinite(v);
  return Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

/** Structural check for anything allowed on an input port or layer prop in a file. */
export function isInputValue(v: unknown): v is InputValue {
  return isLiteral(v) || isLinkInput(v) || isLayerInput(v) || isAssetInput(v) || isLoopLiteral(v) || isJsonLiteral(v) || isGradientLiteral(v);
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default runtime value for a value type (used when a port declares no default). */
export function defaultValue(type: ValueType): Value {
  switch (type) {
    case "number":
    case "index":
      return 0;
    case "boolean":
    case "pulse":
      return false;
    case "text":
    case "enum":
      return "";
    case "color":
      return { r: 0, g: 0, b: 0, a: 1 };
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

/**
 * Default runtime value for a declared (resolved) port: its default, the first enum
 * option, or the type default. Spec colors written as "#RRGGBBAA" text are decoded.
 */
export function defaultForPort(port: { type: ValueType | "variant"; default?: Value; enumOptions?: { key: string }[] }): Value {
  const type = port.type === "variant" ? "any" : port.type;
  if (port.default !== undefined) {
    if (type === "color" && typeof port.default === "string") return parseColor(port.default) ?? defaultValue("color");
    if (type === "gradient" && isGradientLiteral(port.default)) return decodeGradient(port.default);
    return port.default;
  }
  if (type === "enum" && port.enumOptions?.length) return port.enumOptions[0]!.key;
  return defaultValue(type);
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/** A decoded `{ loop: [...] }` literal: the engine maps this marker to its Loop representation. */
export interface DecodedLoop {
  loop: true;
  items: Value[];
}

export function isDecodedLoop(v: unknown): v is DecodedLoop {
  return isPlainObject(v) && v.loop === true && Array.isArray(v.items);
}

/** Guess the value type of a runtime value (used for coercion of untyped data). */
export function inferValueType(value: Value): ValueType {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "text";
  if (Array.isArray(value)) {
    if (value.every((n) => typeof n === "number")) {
      if (value.length === 2) return "point";
      if (value.length === 3) return "point3d";
      if (value.length === 4) return "point4d";
      if (value.length === 16) return "transform";
    }
    return "json";
  }
  if (isColor(value)) return "color";
  return "json";
}

function decodeGradient(lit: GradientLiteral): GradientValue {
  const g = lit.gradient;
  return {
    kind: g.kind,
    stops: (g.stops ?? []).map(([offset, color]) => ({ offset, color: parseColor(color) ?? { r: 0, g: 0, b: 0, a: 0 } })),
    start: [g.start?.[0] ?? 0.5, g.start?.[1] ?? 0],
    end: [g.end?.[0] ?? 0.5, g.end?.[1] ?? 1],
  };
}

/** Decode a single literal for a port of `type`. */
export function decodeLiteral(lit: Literal, type: ValueType): Value {
  if (lit === null) return defaultValue(type);
  if (type === "any") return lit;
  if (typeof lit === "string") {
    switch (type) {
      case "color":
        return parseColor(lit) ?? defaultValue("color");
      case "image":
      case "video":
      case "sound":
        return { url: lit } satisfies AssetRef;
      case "shape":
        return { path: lit };
      case "layer":
        return { layerId: lit } satisfies LayerRef;
      case "json":
        return lit;
      default:
        return coerce(lit, "text", type);
    }
  }
  if (Array.isArray(lit)) {
    if (type === "json") return [...lit];
    return coerce([...lit], inferValueType(lit), type);
  }
  return coerce(lit, typeof lit === "number" ? "number" : "boolean", type);
}

/**
 * Decode a document input value into a runtime value for a port of `portType`.
 * Links return undefined (the engine resolves them). `{ loop }` returns a DecodedLoop
 * marker. A missing value returns the type's default.
 */
export function decodeInput(input: InputValue | undefined, portType: ValueType, _doc?: SonobeDocument): Value | DecodedLoop | undefined {
  if (input === undefined) return defaultValue(portType);
  if (isLinkInput(input)) return undefined;
  if (isLayerInput(input)) return { layerId: input.layer } satisfies LayerRef;
  if (isAssetInput(input)) return { assetId: input.asset } satisfies AssetRef;
  if (isLoopLiteral(input)) return { loop: true, items: input.loop.map((item) => decodeLiteral(item, portType)) };
  if (isJsonLiteral(input)) return portType === "json" || portType === "any" ? input.json : coerce(input.json, "json", portType);
  if (isGradientLiteral(input)) return decodeGradient(input);
  if (isLiteral(input)) return decodeLiteral(input, portType);
  return defaultValue(portType);
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function encodeGradient(g: GradientValue): GradientLiteral {
  return {
    gradient: {
      kind: g.kind,
      stops: g.stops.map((s) => [s.offset, formatColor(s.color)] as [number, string]),
      start: [g.start[0], g.start[1]],
      end: [g.end[0], g.end[1]],
    },
  };
}

const finite = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/** Encode a runtime value as a document input value for a port of `type`. */
export function encodeValue(value: Value | DecodedLoop, type: ValueType): InputValue {
  if (isDecodedLoop(value)) {
    const items = value.items.map((item) => encodeValue(item, type));
    return items.every(isLiteral) ? { loop: items as Literal[] } : { json: value.items };
  }
  if (value === undefined) return null;
  switch (type) {
    case "number":
    case "index":
      return finite(coerce(value, inferValueType(value), type));
    case "boolean":
      return coerce(value, inferValueType(value), "boolean") as boolean;
    case "pulse":
      return null;
    case "text":
    case "enum":
      return coerce(value, inferValueType(value), "text") as string;
    case "color": {
      const c = typeof value === "string" ? parseColor(value) : (coerce(value, inferValueType(value), "color") as Color);
      return formatColor(c ?? { r: 0, g: 0, b: 0, a: 1 });
    }
    case "point":
    case "size":
    case "anchor":
    case "point3d":
    case "point4d":
    case "transform":
      return (coerce(value, inferValueType(value), type) as number[]).map(finite);
    case "layer":
      if (value === null) return null;
      if (typeof value === "string") return { layer: value };
      return isPlainObject(value) && typeof value.layerId === "string" ? { layer: value.layerId } : null;
    case "image":
    case "video":
    case "sound":
      if (isPlainObject(value) && typeof value.assetId === "string") return { asset: value.assetId };
      if (isPlainObject(value) && typeof value.url === "string") return value.url;
      return typeof value === "string" ? value : null;
    case "gradient":
      return isPlainObject(value) && Array.isArray(value.stops) ? encodeGradient(value as unknown as GradientValue) : null;
    case "shape":
      if (typeof value === "string") return value;
      return isPlainObject(value) && typeof value.path === "string" ? value.path : null;
    case "textStyle":
    case "layerEffect":
      return value === null ? null : { json: value };
    case "json":
    case "any":
    default:
      if (isLiteral(value)) return value;
      if (isColor(value)) return type === "any" ? formatColor(value) : { json: value };
      return { json: value };
  }
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

function toNumber(value: Value): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (Array.isArray(value)) return value.length ? toNumber(value[0] as Value) : 0;
  if (isColor(value)) return value.r;
  if (isPlainObject(value)) {
    for (const k of ["x", "width", "value"]) if (k in value) return toNumber(value[k] as Value);
  }
  return 0;
}

function toBoolean(value: Value): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "on") return true;
    if (s === "false" || s === "no" || s === "off" || s === "") return false;
    return toNumber(s) > 0;
  }
  if (Array.isArray(value)) return value.length > 0 && toBoolean(value[0] as Value);
  return false;
}

function toText(value: Value): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "";
  if (isColor(value)) return formatColor(value);
  if (Array.isArray(value) && value.every((n) => typeof n === "number")) return value.map((n) => formatNumber(n as number)).join(", ");
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function toVector(value: Value, size: number): number[] {
  if (typeof value === "number" || typeof value === "boolean") return new Array<number>(size).fill(toNumber(value));
  if (Array.isArray(value)) return Array.from({ length: size }, (_, i) => (i < value.length ? toNumber(value[i] as Value) : 0));
  if (isColor(value)) return [value.r, value.g, value.b, value.a].slice(0, size).concat(new Array<number>(Math.max(0, size - 4)).fill(0));
  if (isPlainObject(value)) {
    const keys = "width" in value ? ["width", "height"] : ["x", "y", "z", "w"];
    return Array.from({ length: size }, (_, i) => (keys[i] !== undefined && keys[i]! in value ? toNumber(value[keys[i]!] as Value) : 0));
  }
  if (typeof value === "string") {
    const nums = value.split(/[\s,]+/).filter(Boolean).map(Number);
    if (nums.length && nums.every(Number.isFinite)) return toVector(nums, size);
  }
  return new Array<number>(size).fill(0);
}

function toColor(value: Value): Color {
  if (isColor(value)) return { r: value.r, g: value.g, b: value.b, a: value.a };
  if (typeof value === "string") return parseColor(value) ?? { r: 0, g: 0, b: 0, a: 1 };
  if (Array.isArray(value)) {
    const [r, g, b, a] = toVector(value, 4);
    return { r: r!, g: g!, b: b!, a: value.length >= 4 ? a! : 1 };
  }
  if (isPlainObject(value) && "x" in value) {
    const [r, g, b, a] = toVector(value, 4);
    return { r: r!, g: g!, b: b!, a: "w" in value ? a! : 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

/**
 * Convert a runtime value between value types (ARCHITECTURE §4 coercion table, plus
 * best-effort parsing of json/any). Unconvertible values become the target default.
 */
export function coerce(value: Value, fromType: ValueType, toType: ValueType): Value {
  if (toType === "any") return value;
  if (fromType === toType && fromType !== "json") return value;
  switch (toType) {
    case "number":
      return toNumber(value);
    case "index":
      return Math.max(0, Math.floor(toNumber(value)));
    case "boolean":
    case "pulse":
      return toBoolean(value);
    case "text":
    case "enum":
      return toText(value);
    case "color":
      return toColor(value);
    case "point":
    case "size":
    case "anchor":
    case "point3d":
    case "point4d":
      return toVector(value, VECTOR_SIZES[toType]!);
    case "transform":
      return Array.isArray(value) && value.length === 16 ? value.map((n) => toNumber(n as Value)) : [...IDENTITY_TRANSFORM];
    case "json":
      return value === undefined ? null : value;
    case "layer":
      if (typeof value === "string") return { layerId: value };
      return isPlainObject(value) && typeof value.layerId === "string" ? value : null;
    case "image":
    case "video":
    case "sound":
      if (typeof value === "string") return { url: value };
      return isPlainObject(value) && (typeof value.assetId === "string" || typeof value.url === "string") ? value : null;
    case "gradient":
      return isPlainObject(value) && Array.isArray(value.stops) ? value : null;
    case "shape":
      if (typeof value === "string") return { path: value };
      return isPlainObject(value) && typeof value.path === "string" ? value : null;
    case "textStyle":
      return isPlainObject(value) ? value : {};
    case "layerEffect":
      return isPlainObject(value) && typeof value.kind === "string" ? value : null;
    default:
      return defaultValue(toType);
  }
}

// ---------------------------------------------------------------------------
// Connection compatibility
// ---------------------------------------------------------------------------

export interface ConnectCheck {
  ok: boolean;
  /** Plain-language description of the implicit conversion (shown as a glyph on the wire). */
  conversion?: string;
  /** Why the connection is invalid. */
  reason?: string;
  /** A patch type that converts between the two types. */
  suggestion?: string;
}

const TYPE_LABELS: Record<ValueType, string> = {
  number: "number",
  boolean: "on/off (boolean)",
  pulse: "pulse",
  text: "text",
  color: "color",
  point: "point [x, y]",
  point3d: "3D point [x, y, z]",
  point4d: "4D point [a, b, c, d]",
  size: "size [w, h]",
  anchor: "anchor [x, y]",
  index: "index",
  enum: "option",
  json: "JSON",
  layer: "layer",
  image: "image",
  video: "video",
  sound: "sound",
  gradient: "gradient",
  shape: "shape",
  textStyle: "text style",
  layerEffect: "layer effect",
  transform: "transform",
  any: "any value",
};

/** Plain-language label for a value type, e.g. "on/off (boolean)". */
export function typeLabel(type: ValueType): string {
  return TYPE_LABELS[type] ?? type;
}

const NUMERIC: ReadonlySet<ValueType> = new Set(["number", "index"]);

/** Candidate converter patch types per invalid pairing; the first one present in a registry wins. */
export const CONVERTER_CANDIDATES: readonly { from: ValueType[] | "*"; to: ValueType[] | "*"; patchTypes: string[]; description: string }[] = [
  { from: ["boolean", "pulse"], to: ["color", "point", "point3d", "point4d", "size", "anchor", "text", "enum"], patchTypes: ["optionPicker", "transition"], description: "Pick between two values with an Option Picker (on/off becomes option 0 or 1)." },
  { from: ["number", "index"], to: ["color"], patchTypes: ["transition"], description: "Blend between two colors with a Transition set to color." },
  { from: ["text"], to: ["color"], patchTypes: ["hexColor", "colorFromHex"], description: "Turn hex text into a color with a Hex Color patch." },
  { from: ["color"], to: ["text"], patchTypes: ["colorToHex"], description: "Turn a color into hex text with a Color to Hex patch." },
  { from: ["color"], to: ["number", "index", "point", "point3d"], patchTypes: ["colorToRgb"], description: "Split a color into channels with a Color to RGB patch." },
  { from: ["point", "size", "anchor"], to: ["point3d", "point4d"], patchTypes: ["pointUnpack", "splitter"], description: "Unpack the point into numbers, then pack them into the bigger point." },
  { from: ["point3d"], to: ["point", "size", "anchor", "point4d"], patchTypes: ["point3dUnpack", "splitter"], description: "Unpack the 3D point into numbers, then pack what you need." },
  { from: ["point4d"], to: ["point", "size", "anchor", "point3d"], patchTypes: ["vec4Unpack", "splitter"], description: "Unpack the 4D point into numbers, then pack what you need." },
  { from: ["text"], to: ["boolean", "pulse"], patchTypes: ["equals", "textEquals"], description: "Compare the text with an Equals patch to get on/off." },
  { from: "*", to: "*", patchTypes: ["splitter"], description: "Cast the value with a Splitter patch." },
];

function findConverter(from: ValueType, to: ValueType) {
  return CONVERTER_CANDIDATES.find((c) => (c.from === "*" || c.from.includes(from)) && (c.to === "*" || c.to.includes(to)));
}

/**
 * Can an output of type `from` drive an input of type `to`?
 * Implements the coercion table in ARCHITECTURE §4.
 */
export function canConnect(from: ValueType, to: ValueType): ConnectCheck {
  if (from === to || to === "any" || from === "any") return { ok: true };
  if (from === "json") return { ok: true, conversion: `JSON is read as ${typeLabel(to)} (best effort)` };
  if (to === "json") return { ok: true, conversion: `${typeLabel(from)} is wrapped as JSON` };

  const fromVec = VECTOR_SIZES[from];
  const toVec = VECTOR_SIZES[to];

  if (NUMERIC.has(from) && NUMERIC.has(to)) return to === "index" ? { ok: true, conversion: "rounded down to a whole number ≥ 0" } : { ok: true };
  if (NUMERIC.has(from) && to === "boolean") return { ok: true, conversion: "on when greater than 0" };
  if (from === "boolean" && NUMERIC.has(to)) return { ok: true, conversion: "on = 1, off = 0" };
  if (from === "pulse" && to === "boolean") return { ok: true };
  if (from === "pulse" && NUMERIC.has(to)) return { ok: true, conversion: "1 on the frame the pulse fires, otherwise 0" };
  if (from === "boolean" && to === "pulse") return { ok: true, conversion: "fires when it turns on" };
  if (NUMERIC.has(from) && to === "pulse") return { ok: true, conversion: "fires when it rises above 0" };
  if (NUMERIC.has(from) && toVec) return { ok: true, conversion: "copied into every component" };
  if (fromVec && NUMERIC.has(to)) return { ok: true, conversion: "uses the first component" };
  if (fromVec && toVec && fromVec === toVec) return { ok: true };
  if (NUMERIC.has(from) && to === "text") return { ok: true, conversion: "formatted as text" };
  if (from === "boolean" && to === "text") return { ok: true, conversion: 'written as "true" or "false"' };
  if (from === "text" && NUMERIC.has(to)) return { ok: true, conversion: "parsed as a number (invalid text becomes 0)" };
  if (from === "enum" && to === "text") return { ok: true };
  if (from === "text" && to === "enum") return { ok: true, conversion: "must match an option key" };
  if (from === "color" && to === "point4d") return { ok: true, conversion: "r, g, b, a become 4 numbers" };
  if (from === "point4d" && to === "color") return { ok: true, conversion: "4 numbers become r, g, b, a (0–1)" };

  let reason = `A ${typeLabel(from)} output can't drive a ${typeLabel(to)} input.`;
  if (fromVec && toVec) reason = `A ${typeLabel(from)} has ${fromVec} numbers but a ${typeLabel(to)} needs ${toVec}.`;
  else if (to === "layer") reason = `Layer inputs take a layer, not a ${typeLabel(from)}. Pick a layer instead: { "layer": "layerId" }.`;
  else if (from === "layer") reason = "A layer reference can only go into a layer input.";
  const converter = to === "layer" || from === "layer" ? undefined : findConverter(from, to);
  return converter ? { ok: false, reason, suggestion: converter.patchTypes[0] } : { ok: false, reason };
}
