/**
 * Parsers for computed CSS values the DOM walker reads: lists and functions split at the top level,
 * lengths, box shadows, gradients, transforms, border radii, and blend modes. Pure functions with no
 * DOM, so they run in Node tests and get bundled into the walker. Colors go through a `ColorFn` the
 * caller provides (the walker resolves any CSS color with a canvas); it returns "#RRGGBBAA", or null
 * for a fully transparent color.
 */

import type { CaptureGradient, CaptureShadow } from "./capture.ts";

export type ColorFn = (css: string) => string | null;

/** Split at `separator` outside parentheses and quotes ("a(b, c), d" → ["a(b, c)", "d"]), dropping empty parts. */
export function splitTopLevel(value: string, separator: "," | " " | "/" | ";"): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const ch of value) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    const isSeparator = separator === " " ? /\s/.test(ch) : ch === separator;
    if (depth === 0 && isSeparator) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((part) => part.trim()).filter((part) => part !== "");
}

/** A px length ("12px", "0", "-3.5px"); null for anything else. */
export function parsePx(token: string | undefined): number | null {
  if (token === undefined) return null;
  const t = token.trim();
  if (t === "0") return 0;
  const m = /^(-?\d*\.?\d+(?:e[+-]?\d+)?)px$/i.exec(t);
  return m ? Number(m[1]) : null;
}

/** "50%" → 0.5; null for anything else. */
export function parsePercent(token: string | undefined): number | null {
  if (token === undefined) return null;
  const m = /^(-?\d*\.?\d+(?:e[+-]?\d+)?)%$/i.exec(token.trim());
  return m ? Number(m[1]) / 100 : null;
}

const isLengthToken = (t: string) => parsePx(t) !== null || /^-?\d*\.?\d+(?:e[+-]?\d+)?(?:px|em|rem|%|vw|vh|pt)?$/i.test(t);

/** Computed box-shadow → shadows, front first. "none" → []. */
export function parseBoxShadows(value: string, toColor: ColorFn): CaptureShadow[] {
  if (!value || value === "none") return [];
  const out: CaptureShadow[] = [];
  for (const part of splitTopLevel(value, ",")) {
    const tokens = splitTopLevel(part, " ");
    let inset = false;
    const lengths: number[] = [];
    const colorTokens: string[] = [];
    for (const token of tokens) {
      if (token === "inset") inset = true;
      else if (isLengthToken(token) && lengths.length < 4) lengths.push(parsePx(token) ?? 0);
      else colorTokens.push(token);
    }
    if (lengths.length < 2) continue;
    const color = toColor(colorTokens.join(" ") || "currentcolor");
    if (!color) continue;
    out.push({ x: lengths[0]!, y: lengths[1]!, blur: Math.max(0, lengths[2] ?? 0), spread: lengths[3] ?? 0, color, ...(inset ? { inset: true } : {}) });
  }
  return out;
}

/** An angle token in degrees ("90deg", "0.25turn", "1.57rad", "100grad"); null for anything else. */
export function parseAngle(token: string): number | null {
  const m = /^(-?\d*\.?\d+(?:e[+-]?\d+)?)(deg|rad|turn|grad)$/i.exec(token.trim());
  if (!m) return token.trim() === "0" ? 0 : null;
  const n = Number(m[1]);
  switch (m[2]!.toLowerCase()) {
    case "rad":
      return (n * 180) / Math.PI;
    case "turn":
      return n * 360;
    case "grad":
      return n * 0.9;
    default:
      return n;
  }
}

const SIDE_ANGLES: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270 };

/** The CSS angle of "to <side> [<side>]" in a w × h box. */
function sideAngle(words: string[], w: number, h: number): number {
  const vertical = words.find((x) => x === "top" || x === "bottom");
  const horizontal = words.find((x) => x === "left" || x === "right");
  if (vertical && horizontal) {
    // Magic corners: the 50% line runs through the other two corners.
    const a = (Math.atan2(h, w) * 180) / Math.PI;
    if (vertical === "top") return horizontal === "right" ? a : 360 - a;
    return horizontal === "right" ? 180 - a : 180 + a;
  }
  return SIDE_ANGLES[vertical ?? horizontal ?? "bottom"] ?? 180;
}

/** "left" | "center" | "30%" | "12px" along an axis of `size` → 0..1. */
function positionComponent(token: string | undefined, size: number, axis: "x" | "y"): number | null {
  if (token === undefined) return null;
  const words: Record<string, number> = axis === "x" ? { left: 0, center: 0.5, right: 1 } : { top: 0, center: 0.5, bottom: 1 };
  if (token in words) return words[token]!;
  const pct = parsePercent(token);
  if (pct !== null) return pct;
  const px = parsePx(token);
  return px !== null && size > 0 ? px / size : null;
}

/** "at 50% 0%", "at left top", "at right" → normalized center. */
function parsePosition(tokens: string[], w: number, h: number): [number, number] {
  if (tokens.length === 0) return [0.5, 0.5];
  let x: number | null = null;
  let y: number | null = null;
  if (tokens.length === 1) {
    const t = tokens[0]!;
    if (t === "top" || t === "bottom") y = positionComponent(t, h, "y");
    else x = positionComponent(t, w, "x");
  } else {
    let [a, b] = tokens as [string, string];
    if (a === "top" || a === "bottom" || b === "left" || b === "right") [a, b] = [b, a];
    x = positionComponent(a, w, "x");
    y = positionComponent(b, h, "y");
  }
  return [x ?? 0.5, y ?? 0.5];
}

/** Stops "color [pos [pos]]" → offsets 0..1 with missing offsets spread evenly. Positions in px use `length`. */
function parseStops(args: string[], toColor: ColorFn, length: number, colorOnly = false): [number, string][] | null {
  const raw: { color: string; offset: number | null }[] = [];
  for (const arg of args) {
    const tokens = splitTopLevel(arg, " ");
    const positions: (number | null)[] = [];
    while (tokens.length > 1) {
      const last = tokens[tokens.length - 1]!;
      const pct = parsePercent(last);
      const px = parsePx(last);
      const deg = parseAngle(last);
      if (pct !== null) positions.unshift(pct);
      else if (px !== null) positions.unshift(length > 0 ? px / length : 0);
      else if (deg !== null && colorOnly) positions.unshift(deg / 360);
      else break;
      tokens.pop();
    }
    // A bare position is a color hint (the midpoint of the transition); ignore it.
    if (tokens.length === 1 && (parsePercent(tokens[0]) !== null || parsePx(tokens[0]) !== null)) continue;
    const color = toColor(tokens.join(" ")) ?? "#00000000";
    if (positions.length === 0) raw.push({ color, offset: null });
    else for (const p of positions.slice(0, 2)) raw.push({ color, offset: p });
  }
  if (raw.length === 0) return null;
  if (raw[0]!.offset === null) raw[0]!.offset = 0;
  if (raw[raw.length - 1]!.offset === null) raw[raw.length - 1]!.offset = raw.length === 1 ? 0 : 1;
  // Positions never go backwards; missing ones are spread between their known neighbours.
  let max = 0;
  for (const s of raw) if (s.offset !== null) s.offset = max = Math.max(max, s.offset);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i]!.offset !== null) continue;
    let j = i;
    while (raw[j]!.offset === null) j++;
    const from = raw[i - 1]!.offset!;
    const to = raw[j]!.offset!;
    for (let k = i; k < j; k++) raw[k]!.offset = from + ((to - from) * (k - i + 1)) / (j - i + 1);
    i = j;
  }
  return raw.map((s) => [round(s.offset!), s.color]);
}

const round = (n: number, places = 4) => {
  const f = 10 ** places;
  return Math.round(n * f) / f || 0;
};

/** One computed gradient function in a w × h box; null when it isn't a gradient Sonobe can draw. */
export function parseGradient(value: string, toColor: ColorFn, w: number, h: number): CaptureGradient | null {
  const m = /^(repeating-)?(linear|radial|conic)-gradient\(([\s\S]*)\)$/i.exec(value.trim());
  if (!m) return null;
  const kind = m[2]!.toLowerCase();
  const args = splitTopLevel(m[3]!, ",");
  if (args.length === 0) return null;
  const first = args[0]!;
  const firstTokens = splitTopLevel(first, " ");
  const stripInterpolation = (tokens: string[]) => {
    const i = tokens.indexOf("in");
    return i >= 0 ? tokens.slice(0, i) : tokens;
  };

  if (kind === "linear") {
    let angle = 180;
    let stopArgs = args;
    const tokens = stripInterpolation(firstTokens);
    const isDirection = firstTokens[0] === "to" || firstTokens[0] === "in" || (tokens.length === 1 && parseAngle(tokens[0]!) !== null);
    if (isDirection) {
      stopArgs = args.slice(1);
      if (tokens[0] === "to") angle = sideAngle(tokens.slice(1), w, h);
      else if (tokens.length === 1) angle = parseAngle(tokens[0]!) ?? 180;
    }
    const theta = (angle * Math.PI) / 180;
    const dirX = Math.sin(theta);
    const dirY = -Math.cos(theta);
    const length = Math.abs(w * dirX) + Math.abs(h * dirY);
    const stops = parseStops(stopArgs, toColor, length);
    if (!stops) return null;
    const half = length / 2;
    const sx = w > 0 ? (w / 2 - dirX * half) / w : 0.5;
    const sy = h > 0 ? (h / 2 - dirY * half) / h : 0;
    const ex = w > 0 ? (w / 2 + dirX * half) / w : 0.5;
    const ey = h > 0 ? (h / 2 + dirY * half) / h : 1;
    return { kind: "linear", stops, start: [round(sx), round(sy)], end: [round(ex), round(ey)] };
  }

  const tokens = stripInterpolation(firstTokens);
  const atIndex = tokens.indexOf("at");
  const shapeTokens = atIndex >= 0 ? tokens.slice(0, atIndex) : tokens;
  const positionTokens = atIndex >= 0 ? tokens.slice(atIndex + 1) : [];

  if (kind === "radial") {
    const shapeWords = new Set(["circle", "ellipse", "closest-side", "closest-corner", "farthest-side", "farthest-corner"]);
    const isShape = firstTokens[0] === "in" || atIndex >= 0 || shapeTokens.some((t) => shapeWords.has(t) || parsePx(t) !== null || parsePercent(t) !== null);
    const stopArgs = isShape ? args.slice(1) : args;
    const [cx, cy] = parsePosition(positionTokens, w, h);
    const px = cx * w;
    const py = cy * h;
    const circle = shapeTokens.includes("circle");
    const sizes = shapeTokens.map((t) => parsePx(t) ?? (parsePercent(t) !== null ? parsePercent(t)! : null)).filter((n): n is number => n !== null);
    const dxs = [px, w - px];
    const dys = [py, h - py];
    let rx: number;
    let ry: number;
    const keyword = shapeTokens.find((t) => t.includes("side") || t.includes("corner")) ?? "farthest-corner";
    if (sizes.length >= 1 && shapeTokens.some((t) => parsePx(t) !== null)) {
      rx = parsePx(shapeTokens.find((t) => parsePx(t) !== null)) ?? 0;
      ry = sizes.length >= 2 ? (parsePx(shapeTokens.filter((t) => parsePx(t) !== null)[1]) ?? rx) : rx;
    } else {
      const side = keyword.startsWith("closest") ? Math.min : Math.max;
      const sx = side(...dxs);
      const sy = side(...dys);
      if (circle) {
        const r = keyword.endsWith("corner") ? Math.hypot(sx, sy) : side(sx, sy);
        rx = ry = r;
      } else if (keyword.endsWith("corner")) {
        rx = sx * Math.SQRT2;
        ry = sy * Math.SQRT2;
      } else {
        rx = sx;
        ry = sy;
      }
    }
    const stops = parseStops(stopArgs, toColor, Math.max(rx, ry));
    if (!stops) return null;
    const out: CaptureGradient = { kind: "radial", stops, start: [round(cx), round(cy)], end: [round(cx), round(h > 0 ? (py + Math.max(ry, 0.001)) / h : cy)] };
    if (ry > 0 && Math.abs(rx / ry - 1) > 0.001) out.ratio = round(rx / ry);
    return out;
  }

  // conic
  const isShape = firstTokens[0] === "from" || firstTokens[0] === "in" || atIndex >= 0;
  const stopArgs = isShape ? args.slice(1) : args;
  const fromIndex = shapeTokens.indexOf("from");
  const from = fromIndex >= 0 ? (parseAngle(shapeTokens[fromIndex + 1] ?? "0") ?? 0) : 0;
  const [cx, cy] = parsePosition(positionTokens, w, h);
  const stops = parseStops(stopArgs, toColor, 0, true);
  if (!stops) return null;
  const theta = (from * Math.PI) / 180;
  const reach = 0.25;
  return { kind: "angular", stops, start: [round(cx), round(cy)], end: [round(cx + (Math.sin(theta) * reach * Math.max(w, h)) / Math.max(w, 1)), round(cy - (Math.cos(theta) * reach * Math.max(w, h)) / Math.max(h, 1))] };
}

/** background-image layers: gradients (back to front) and the first url(). */
export function parseBackgroundImages(value: string, toColor: ColorFn, w: number, h: number): { gradients: CaptureGradient[]; url: string | null; unsupported: number } {
  const gradients: CaptureGradient[] = [];
  let url: string | null = null;
  let unsupported = 0;
  if (!value || value === "none") return { gradients, url, unsupported };
  // CSS lists background layers front first; Sonobe paints back to front.
  for (const layer of splitTopLevel(value, ",").reverse()) {
    if (layer === "none") continue;
    const u = /^url\(\s*(["']?)([\s\S]*?)\1\s*\)$/i.exec(layer);
    if (u) {
      url = u[2]!;
      continue;
    }
    const g = parseGradient(layer, toColor, w, h);
    if (g) gradients.push(g);
    else unsupported++;
  }
  return { gradients, url, unsupported };
}

export interface Transform2D {
  rotation: number;
  scale: number;
  /** Scale differs by axis or the matrix skews, so rotation and scale are approximate. */
  approximate: boolean;
}

/** Computed transform (matrix(...) / matrix3d(...)) → rotation and uniform scale; null for none or identity. */
export function parseTransform(value: string): Transform2D | null {
  if (!value || value === "none") return null;
  const m = /^matrix(3d)?\(([^)]*)\)$/.exec(value.trim());
  if (!m) return null;
  const n = m[2]!.split(",").map((s) => Number(s.trim()));
  if (n.some((x) => !Number.isFinite(x))) return null;
  const [a, b, c, d] = m[1] ? [n[0]!, n[1]!, n[4]!, n[5]!] : [n[0]!, n[1]!, n[2]!, n[3]!];
  const sx = Math.hypot(a, b);
  const sy = Math.hypot(c, d);
  const rotation = round((Math.atan2(b, a) * 180) / Math.PI, 2);
  const scale = round((sx + sy) / 2, 4);
  if (Math.abs(rotation) < 0.01 && Math.abs(scale - 1) < 0.0001) return null;
  const skew = Math.abs(a * c + b * d) > 1e-6;
  return { rotation, scale, approximate: skew || Math.abs(sx - sy) > 0.01 };
}

/** One computed corner radius ("12px", "12px 8px", "50%") for a w × h box. */
export function parseRadius(value: string, w: number, h: number): number {
  const tokens = splitTopLevel(value ?? "", " ");
  const horizontal = tokens[0];
  const vertical = tokens[1] ?? tokens[0];
  const resolve = (t: string | undefined, size: number) => parsePx(t) ?? (parsePercent(t) !== null ? parsePercent(t)! * size : 0);
  const rx = resolve(horizontal, w);
  const ry = resolve(vertical, h);
  return Math.max(0, Math.min(rx, ry));
}

/** Scale radii down like CSS does when adjacent corners overlap. */
export function clampRadii(radii: [number, number, number, number], w: number, h: number): [number, number, number, number] {
  const [tl, tr, br, bl] = radii;
  const f = Math.min(1, w / Math.max(tl + tr, 1e-9), w / Math.max(bl + br, 1e-9), h / Math.max(tl + bl, 1e-9), h / Math.max(tr + br, 1e-9));
  return f < 1 ? [tl * f, tr * f, br * f, bl * f] : radii;
}

const BLEND_MODES: Record<string, string> = {
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color-dodge": "colorDodge",
  "color-burn": "colorBurn",
  "hard-light": "hardLight",
  "soft-light": "softLight",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
  "plus-darker": "plusDarker",
  "plus-lighter": "plusLighter",
};

/** mix-blend-mode → Sonobe blend mode key; undefined for normal or unknown. */
export function blendModeKey(value: string): string | undefined {
  return BLEND_MODES[value];
}

/** The first blur(<px>) in a filter list; 0 when there's none. */
export function parseBlur(value: string): number {
  const m = /blur\(\s*(-?\d*\.?\d+)px\s*\)/i.exec(value ?? "");
  return m ? Math.max(0, Number(m[1])) : 0;
}

/** rgb()/rgba() in either syntax → "#RRGGBBAA"; null when it isn't one, "transparent" → "#00000000". */
export function parseRgb(value: string): string | null {
  const v = value.trim();
  if (v === "transparent") return "#00000000";
  const m = /^rgba?\(\s*(-?[\d.]+%?)[\s,]+(-?[\d.]+%?)[\s,]+(-?[\d.]+%?)(?:\s*[,/]\s*(-?[\d.]+%?))?\s*\)$/i.exec(v);
  if (!m) return null;
  const channel = (t: string) => {
    const n = t.endsWith("%") ? (Number(t.slice(0, -1)) * 255) / 100 : Number(t);
    return Math.max(0, Math.min(255, Math.round(n)));
  };
  const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  if ([m[1], m[2], m[3]].some((t) => !Number.isFinite(Number(t!.replace("%", ""))))) return null;
  return toHex(channel(m[1]!), channel(m[2]!), channel(m[3]!), Number.isFinite(alpha) ? alpha : 1);
}

export function toHex(r: number, g: number, b: number, alpha: number): string {
  const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0").toUpperCase();
  return `#${hex(r)}${hex(g)}${hex(b)}${hex(Math.max(0, Math.min(1, alpha)) * 255)}`;
}

/** "#RRGGBBAA" → alpha 0..1. */
export function hexAlpha(color: string): number {
  return parseInt(color.slice(7, 9), 16) / 255;
}

/** Collapse whitespace the way `white-space: normal` renders it. */
export function collapseWhitespace(text: string, whiteSpace: string): string {
  switch (whiteSpace) {
    case "pre":
    case "pre-wrap":
    case "break-spaces":
      return text;
    case "pre-line":
      return text.replace(/[ \t\f\r]+/g, " ").replace(/ *\n */g, "\n");
    default:
      return text.replace(/\s+/g, " ");
  }
}

/** "checkout-form_v2" → "Checkout Form V2". */
export function titleize(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/** A font-family stack → family names, unquoted ("\"Inter Variable\", system-ui" → ["Inter Variable", "system-ui"]). */
export function parseFontFamilies(stack: string): string[] {
  return splitTopLevel(stack, ",")
    .map((f) => f.trim().replace(/^(["'])(.*)\1$/, "$2").trim())
    .filter(Boolean);
}

const FONT_FORMAT_RANK: Record<string, number> = { woff2: 4, "woff2-variations": 4, woff: 3, "woff-variations": 3, opentype: 2, truetype: 2, "opentype-variations": 2, "truetype-variations": 2 };

/** The best downloadable file in an @font-face src list (woff2 first); null for local() only. */
export function pickFontSource(src: string, base: string): string | null {
  let best: { url: string; rank: number } | null = null;
  for (const part of splitTopLevel(src, ",")) {
    const url = /url\(\s*(["']?)([\s\S]*?)\1\s*\)/i.exec(part)?.[2];
    if (!url) continue;
    const format = /format\(\s*["']?([\w-]+)["']?\s*\)/i.exec(part)?.[1]?.toLowerCase();
    const ext = /\.(woff2|woff|ttf|otf)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
    const rank = format ? (FONT_FORMAT_RANK[format] ?? 0) : ext === "woff2" ? 4 : ext === "woff" ? 3 : ext ? 2 : 1;
    if (rank === 0) continue;
    let absolute: string;
    try {
      absolute = url.startsWith("data:") ? url : new URL(url, base).href;
    } catch {
      continue;
    }
    if (!best || rank > best.rank) best = { url: absolute, rank };
  }
  return best?.url ?? null;
}

/** Whether a unicode-range covers basic Latin letters (empty: the face covers everything). */
export function coversLatin(range: string | undefined): boolean {
  if (!range?.trim()) return true;
  for (const part of splitTopLevel(range, ",")) {
    const m = /^U\+([0-9a-f?]+)(?:-([0-9a-f]+))?$/i.exec(part.trim());
    if (!m) continue;
    const start = parseInt(m[1]!.replace(/\?/g, "0"), 16);
    const end = m[2] ? parseInt(m[2], 16) : parseInt(m[1]!.replace(/\?/g, "f"), 16);
    if (start <= 0x41 && end >= 0x7a) return true;
  }
  return false;
}

/** An @font-face font-weight as the weights it covers ("bold" → [700, 700], "100 900"; none is normal); null when it isn't one. */
function fontWeightRange(weight: string | undefined): [number, number] | null {
  const parts = (weight?.trim().toLowerCase() || "normal").split(/\s+/).map((w) => (w === "normal" ? 400 : w === "bold" ? 700 : Number(w)));
  if (parts.length > 2 || !parts.every((w) => Number.isFinite(w) && w >= 1 && w <= 1000)) return null;
  return [Math.min(...parts), Math.max(...parts)];
}

/**
 * The font-weight of one face covering two @font-face faces of the same file, as a variable font serves
 * several weights from one file: "400" and "700" → "400 700". A weight that already covers the other stays
 * as it is (undefined is normal), and so does one either side can't be read as.
 */
export function mergeFontWeights(a: string | undefined, b: string | undefined): string | undefined {
  const ra = fontWeightRange(a);
  const rb = fontWeightRange(b);
  if (!ra || !rb || (rb[0] >= ra[0] && rb[1] <= ra[1])) return a;
  return `${Math.min(ra[0], rb[0])} ${Math.max(ra[1], rb[1])}`;
}

export interface FontFaceRule {
  family: string;
  src: string;
  weight?: string;
  style?: string;
  unicodeRange?: string;
}

/** @font-face rules from stylesheet text (for sheets the page can't read through CSSOM, like cross-origin ones). */
export function parseFontFaceRules(css: string): FontFaceRule[] {
  const out: FontFaceRule[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const decls = new Map<string, string>();
    for (const decl of splitTopLevel(m[1]!, ";")) {
      const i = decl.indexOf(":");
      if (i > 0) decls.set(decl.slice(0, i).trim().toLowerCase(), decl.slice(i + 1).trim());
    }
    const family = decls.get("font-family");
    const src = decls.get("src");
    if (!family || !src) continue;
    const rule: FontFaceRule = { family: parseFontFamilies(family)[0] ?? family, src };
    if (decls.get("font-weight")) rule.weight = decls.get("font-weight")!;
    if (decls.get("font-style")) rule.style = decls.get("font-style")!;
    if (decls.get("unicode-range")) rule.unicodeRange = decls.get("unicode-range")!;
    out.push(rule);
  }
  return out;
}
