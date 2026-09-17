/**
 * Tolerant readers for resolved layer props. The engine hands the renderer runtime
 * values (Color objects, AssetRef, GradientValue...), but documents store literal
 * encodings ("#RRGGBBAA", { asset }, { gradient }). Both are accepted so the renderer
 * also works on hand-written frames and defaults straight from the layer specs.
 */

import { LAYER_TYPE_MAP } from "@sonobe/core";
import type { Color, GradientStop, GradientValue, LayerRef } from "@sonobe/core";

const defaultsByType = new Map<string, Map<string, unknown>>();

/** Default value for a layer prop as declared in `layerTypes.ts` (undefined when undeclared). */
export function layerDefault(type: string, key: string): unknown {
  let defaults = defaultsByType.get(type);
  if (!defaults) {
    defaults = new Map();
    const spec = LAYER_TYPE_MAP.get(type);
    if (spec) for (const p of spec.props) defaults.set(p.key, p.default);
    defaultsByType.set(type, defaults);
  }
  return defaults.get(key);
}

export function readNumber(v: unknown, fallback: number): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  if (Array.isArray(v) && typeof v[0] === "number") return readNumber(v[0], fallback);
  return fallback;
}

export function readBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v > 0;
  if (typeof v === "string") return v === "true" ? true : v === "false" ? false : fallback;
  return fallback;
}

export function readString(v: unknown, fallback: string): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fallback;
}

/** Reads an n-component vector; a scalar broadcasts to every component. */
export function readVec(v: unknown, n: number, fallback: readonly number[]): number[] {
  if (typeof v === "number" && Number.isFinite(v)) return Array.from({ length: n }, () => v);
  if (Array.isArray(v)) {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(readNumber(v[i] ?? v[v.length - 1], fallback[i] ?? 0));
    return out;
  }
  return fallback.slice(0, n);
}

const HEX = /^#([0-9a-f]{3,8})$/i;

/** Parses a runtime Color, "#RGB[A]" / "#RRGGBB[AA]", or [r, g, b, a] in 0..1. */
export function parseColor(v: unknown): Color | null {
  if (v == null) return null;
  if (typeof v === "string") {
    if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    const m = HEX.exec(v.trim());
    if (!m) return null;
    let hex = m[1]!;
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
    if (hex.length !== 6 && hex.length !== 8) return null;
    const byte = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
    return { r: byte(0), g: byte(2), b: byte(4), a: hex.length === 8 ? byte(6) : 1 };
  }
  if (Array.isArray(v)) {
    if (v.length < 3) return null;
    return { r: readNumber(v[0], 0), g: readNumber(v[1], 0), b: readNumber(v[2], 0), a: readNumber(v[3], 1) };
  }
  if (typeof v === "object") {
    const c = v as Partial<Color>;
    if (typeof c.r === "number" && typeof c.g === "number" && typeof c.b === "number") {
      return { r: c.r, g: c.g, b: c.b, a: typeof c.a === "number" ? c.a : 1 };
    }
  }
  return null;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Formats a number for CSS: up to 4 decimals, no exponent, no -0. */
export function fmt(n: number, decimals = 4): string {
  if (!Number.isFinite(n)) return "0";
  const p = 10 ** decimals;
  const r = Math.round(n * p) / p;
  return Object.is(r, -0) ? "0" : String(r);
}

export const px = (n: number) => `${fmt(n)}px`;

/** CSS rgba() for a color, with an optional alpha multiplier. */
export function cssColor(c: Color, alphaMul = 1): string {
  const ch = (x: number) => Math.round(clamp01(x) * 255);
  return `rgba(${ch(c.r)}, ${ch(c.g)}, ${ch(c.b)}, ${fmt(clamp01(c.a * alphaMul), 3)})`;
}

/** Resolves an image/video value to a URL: AssetRef, { asset }, or a plain URL string. */
export function readAssetUrl(v: unknown, resolve: (assetId: string) => string | undefined): string | null {
  if (typeof v === "string") return v === "" ? null : v;
  if (v && typeof v === "object") {
    const o = v as { assetId?: unknown; url?: unknown; asset?: unknown };
    if (typeof o.url === "string" && o.url !== "") return o.url;
    const id = typeof o.assetId === "string" ? o.assetId : typeof o.asset === "string" ? o.asset : null;
    if (id) return resolve(id) ?? null;
  }
  return null;
}

/** Reads a GradientValue or the document literal `{ gradient: { stops: [[offset, "#hex"]] } }`. */
export function readGradient(v: unknown): GradientValue | null {
  if (!v || typeof v !== "object") return null;
  const raw = "gradient" in v ? (v as { gradient: unknown }).gradient : v;
  if (!raw || typeof raw !== "object") return null;
  const g = raw as { kind?: unknown; stops?: unknown; start?: unknown; end?: unknown };
  if (!Array.isArray(g.stops)) return null;
  const kind = g.kind === "radial" || g.kind === "angular" ? g.kind : "linear";
  const stops: GradientStop[] = [];
  for (const s of g.stops) {
    if (Array.isArray(s)) {
      const color = parseColor(s[1]);
      if (color) stops.push({ offset: readNumber(s[0], 0), color });
    } else if (s && typeof s === "object") {
      const o = s as { offset?: unknown; color?: unknown };
      const color = parseColor(o.color);
      if (color) stops.push({ offset: readNumber(o.offset, 0), color });
    }
  }
  if (stops.length === 0) return null;
  stops.sort((a, b) => a.offset - b.offset);
  const start = readVec(g.start, 2, [0.5, 0]) as [number, number];
  const end = readVec(g.end, 2, [0.5, 1]) as [number, number];
  return { kind, stops, start, end };
}

/** Reads a ShapeValue ({ path }) or raw SVG path data. */
export function readShapePath(v: unknown): string | null {
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (v && typeof v === "object" && typeof (v as { path?: unknown }).path === "string") {
    const path = (v as { path: string }).path;
    return path.trim() === "" ? null : path;
  }
  return null;
}

/** Reads a LayerRef, `{ layer }` literal, or a bare layer id. */
export function readLayerRef(v: unknown): LayerRef | null {
  if (typeof v === "string" && v !== "") return { layerId: v };
  if (v && typeof v === "object") {
    const o = v as { layerId?: unknown; layer?: unknown; instance?: unknown };
    const id = typeof o.layerId === "string" ? o.layerId : typeof o.layer === "string" ? o.layer : null;
    if (id) return typeof o.instance === "number" ? { layerId: id, instance: o.instance } : { layerId: id };
  }
  return null;
}

/** Typed accessors for one node's props with spec defaults applied. */
export interface PropReader {
  raw(key: string): unknown;
  num(key: string, fallback?: number): number;
  bool(key: string, fallback?: boolean): boolean;
  str(key: string, fallback?: string): string;
  vec(key: string, n: number, fallback?: readonly number[]): number[];
  color(key: string): Color | null;
}

export function propReader(type: string, props: Readonly<Record<string, unknown>>): PropReader {
  const raw = (key: string): unknown => {
    const v = props[key];
    return v === undefined || v === null ? layerDefault(type, key) : v;
  };
  return {
    raw,
    num: (key, fallback) => readNumber(raw(key), fallback ?? readNumber(layerDefault(type, key), 0)),
    bool: (key, fallback) => readBool(raw(key), fallback ?? readBool(layerDefault(type, key), false)),
    str: (key, fallback) => readString(raw(key), fallback ?? readString(layerDefault(type, key), "")),
    vec: (key, n, fallback) => readVec(raw(key), n, fallback ?? readVec(layerDefault(type, key), n, new Array<number>(n).fill(0))),
    color: (key) => parseColor(raw(key)),
  };
}
