/**
 * The shared SVG path module for shape patches: canonical path text (`cmd` / `f`), an SVG 2 path
 * parser that normalizes to absolute M, L, C, Q, A, Z segments, uniform transforms, winding and
 * reversal (Shape Union), point reading (Line Shape, JSON to Shape), and a tolerant, DOM-free
 * reader for pasted `<svg>` markup (SVG Path Shape).
 */

import { isPlainObject } from "../infra/index.ts";

/** An absolute path segment: the command letter followed by its numbers. */
export type Segment =
  | ["M", number, number]
  | ["L", number, number]
  | ["C", number, number, number, number, number, number]
  | ["Q", number, number, number, number]
  | ["A", number, number, number, number, number, number, number]
  | ["Z"];

/** Path coordinates are clamped to ±1,000,000 when written. */
export const MAX_COORDINATE = 1_000_000;

/** A number as path text: clamped to ±1,000,000, rounded to 3 decimals, `-0` as `0`, never exponent notation. */
export function f(n: number): string {
  if (Number.isNaN(n)) return "0";
  const r = Math.round(Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, n)) * 1000) / 1000;
  return r === 0 ? "0" : String(r);
}

/** The command letter followed by its numbers separated by single spaces (`M50 0`). */
export function cmd(letter: string, ...numbers: readonly number[]): string {
  let out = letter;
  for (let i = 0; i < numbers.length; i++) out += (i === 0 ? "" : " ") + f(numbers[i]!);
  return out;
}

/** Absolute segments as path text, commands joined with one space. */
export function formatPath(segments: readonly Segment[]): string {
  const parts = new Array<string>(segments.length);
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    parts[i] = cmd(s[0], ...(s.slice(1) as number[]));
  }
  return parts.join(" ");
}

/** An exact ellipse from four clockwise quarter arcs, starting at the top center. */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const arc = (x: number, y: number) => cmd("A", rx, ry, 0, 0, 1, x, y);
  return [cmd("M", cx, cy - ry), arc(cx + rx, cy), arc(cx, cy + ry), arc(cx - rx, cy), arc(cx, cy - ry), "Z"].join(" ");
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ParsedPath {
  /** Every segment before the first syntax error. */
  segments: Segment[];
  /** Why parsing stopped, or null when the whole text was read. */
  syntaxError: string | null;
  /** 1-based character index where parsing stopped, or null. */
  errorAt: number | null;
}

const ARG_COUNTS: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const COMMAND_LETTERS = "MLHVCSQTAZmlhvcsqtaz";

const isWsp = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
const isDigit = (c: number) => c >= 48 && c <= 57;
/** Digit, sign, or decimal point. */
const isNumberStart = (c: number) => isDigit(c) || c === 43 || c === 45 || c === 46;

/**
 * Parse SVG path data (SVG 2 grammar) into absolute segments: relative commands become absolute,
 * H and V become L, S and T become C and Q with reflected controls, zero-radius arcs become L, and
 * a drawing command right after Z starts a new subpath with an explicit M. Parsing stops at the
 * first syntax error and keeps the segments before the failing command.
 */
export function parsePath(text: string): ParsedPath {
  const segments: Segment[] = [];
  const n = text.length;
  let i = 0;

  const fail = (at: number, reason: string): ParsedPath => ({
    segments,
    syntaxError: `Path data stops at character ${at + 1}: ${reason}`,
    errorAt: at + 1,
  });
  const skipWsp = () => {
    while (i < n && isWsp(text.charCodeAt(i))) i++;
  };
  const skipCommaWsp = () => {
    skipWsp();
    if (i < n && text.charCodeAt(i) === 44) {
      i++;
      skipWsp();
    }
  };
  const readNumber = (): number | null => {
    const start = i;
    if (i < n && (text[i] === "+" || text[i] === "-")) i++;
    let digits = 0;
    while (i < n && isDigit(text.charCodeAt(i))) {
      i++;
      digits++;
    }
    if (i < n && text[i] === ".") {
      i++;
      while (i < n && isDigit(text.charCodeAt(i))) {
        i++;
        digits++;
      }
    }
    if (digits === 0) {
      i = start;
      return null;
    }
    if (i < n && (text[i] === "e" || text[i] === "E")) {
      let j = i + 1;
      if (j < n && (text[j] === "+" || text[j] === "-")) j++;
      if (j < n && isDigit(text.charCodeAt(j))) {
        while (j < n && isDigit(text.charCodeAt(j))) j++;
        i = j;
      }
    }
    const value = Number(text.slice(start, i));
    if (!Number.isFinite(value)) {
      i = start;
      return null;
    }
    return value;
  };
  const readFlag = (): number | null => {
    const c = text[i];
    if (c !== "0" && c !== "1") return null;
    i++;
    return c === "1" ? 1 : 0;
  };

  skipWsp();
  if (i >= n) return { segments, syntaxError: null, errorAt: null };
  if (text[i] !== "M" && text[i] !== "m") return fail(i, `the path must start with "M", not "${text[i]}".`);

  let letter = "M";
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cubic: [number, number] | null = null;
  let quad: [number, number] | null = null;
  const args: number[] = [];
  const push = (seg: Segment) => {
    if (seg[0] !== "M" && segments.length > 0 && segments[segments.length - 1]![0] === "Z") segments.push(["M", sx, sy]);
    segments.push(seg);
  };

  for (;;) {
    skipWsp();
    if (i >= n) break;
    const ch = text[i]!;
    let explicit = false;
    if (COMMAND_LETTERS.includes(ch)) {
      letter = ch;
      explicit = true;
      i++;
      skipWsp();
    } else if (isNumberStart(text.charCodeAt(i))) {
      if (letter === "Z" || letter === "z") return fail(i, `expected a command after "${letter}".`);
    } else {
      return fail(i, `unknown command "${ch}".`);
    }

    const upper = letter.toUpperCase();
    const relative = letter !== upper;
    const command = !explicit && upper === "M" ? "L" : upper;
    const count = ARG_COUNTS[command]!;
    args.length = 0;
    for (let k = 0; k < count; k++) {
      if (k > 0) skipCommaWsp();
      const flag = command === "A" && (k === 3 || k === 4);
      const v = flag ? readFlag() : readNumber();
      if (v === null) return fail(i, flag ? `expected an arc flag (0 or 1) after "${letter}".` : `expected a number after "${letter}".`);
      args.push(v);
    }
    if (count > 0) skipCommaWsp();

    const ox = relative ? cx : 0;
    const oy = relative ? cy : 0;
    switch (command) {
      case "M":
        cx = sx = args[0]! + ox;
        cy = sy = args[1]! + oy;
        segments.push(["M", cx, cy]);
        cubic = quad = null;
        break;
      case "L":
        cx = args[0]! + ox;
        cy = args[1]! + oy;
        push(["L", cx, cy]);
        cubic = quad = null;
        break;
      case "H":
        cx = args[0]! + ox;
        push(["L", cx, cy]);
        cubic = quad = null;
        break;
      case "V":
        cy = args[0]! + oy;
        push(["L", cx, cy]);
        cubic = quad = null;
        break;
      case "C": {
        const x2 = args[2]! + ox;
        const y2 = args[3]! + oy;
        const x = args[4]! + ox;
        const y = args[5]! + oy;
        push(["C", args[0]! + ox, args[1]! + oy, x2, y2, x, y]);
        cubic = [x2, y2];
        quad = null;
        cx = x;
        cy = y;
        break;
      }
      case "S": {
        const x1: number = cubic ? 2 * cx - cubic[0] : cx;
        const y1: number = cubic ? 2 * cy - cubic[1] : cy;
        const x2 = args[0]! + ox;
        const y2 = args[1]! + oy;
        const x = args[2]! + ox;
        const y = args[3]! + oy;
        push(["C", x1, y1, x2, y2, x, y]);
        cubic = [x2, y2];
        quad = null;
        cx = x;
        cy = y;
        break;
      }
      case "Q": {
        const x1 = args[0]! + ox;
        const y1 = args[1]! + oy;
        const x = args[2]! + ox;
        const y = args[3]! + oy;
        push(["Q", x1, y1, x, y]);
        quad = [x1, y1];
        cubic = null;
        cx = x;
        cy = y;
        break;
      }
      case "T": {
        const x1: number = quad ? 2 * cx - quad[0] : cx;
        const y1: number = quad ? 2 * cy - quad[1] : cy;
        const x = args[0]! + ox;
        const y = args[1]! + oy;
        push(["Q", x1, y1, x, y]);
        quad = [x1, y1];
        cubic = null;
        cx = x;
        cy = y;
        break;
      }
      case "A": {
        const rx = Math.abs(args[0]!);
        const ry = Math.abs(args[1]!);
        const x = args[5]! + ox;
        const y = args[6]! + oy;
        push(rx === 0 || ry === 0 ? ["L", x, y] : ["A", rx, ry, args[2]!, args[3]!, args[4]!, x, y]);
        cubic = quad = null;
        cx = x;
        cy = y;
        break;
      }
      default:
        if (segments.length > 0 && segments[segments.length - 1]![0] !== "Z") segments.push(["Z"]);
        cx = sx;
        cy = sy;
        cubic = quad = null;
    }
  }
  return { segments, syntaxError: null, errorAt: null };
}

// ---------------------------------------------------------------------------
// Transforms, winding, reversal
// ---------------------------------------------------------------------------

/** Scale every coordinate uniformly by `s` and translate: x → x·s + tx, y → y·s + ty; arc radii × s. */
export function transformSegments(segments: readonly Segment[], s: number, tx: number, ty: number): Segment[] {
  const X = (x: number) => x * s + tx;
  const Y = (y: number) => y * s + ty;
  return segments.map((seg): Segment => {
    switch (seg[0]) {
      case "M":
      case "L":
        return [seg[0], X(seg[1]), Y(seg[2])];
      case "C":
        return ["C", X(seg[1]), Y(seg[2]), X(seg[3]), Y(seg[4]), X(seg[5]), Y(seg[6])];
      case "Q":
        return ["Q", X(seg[1]), Y(seg[2]), X(seg[3]), Y(seg[4])];
      case "A":
        return ["A", seg[1] * s, seg[2] * s, seg[3], seg[4], seg[5], X(seg[6]), Y(seg[7])];
      default:
        return ["Z"];
    }
  });
}

function endPoint(seg: Segment, current: readonly [number, number]): [number, number] {
  switch (seg[0]) {
    case "M":
    case "L":
      return [seg[1], seg[2]];
    case "C":
      return [seg[5], seg[6]];
    case "Q":
      return [seg[3], seg[4]];
    case "A":
      return [seg[6], seg[7]];
    default:
      return [current[0], current[1]];
  }
}

/** Split into subpaths, each starting at an M (a leading drawing command starts at the origin). */
function subpaths(segments: readonly Segment[]): Segment[][] {
  const out: Segment[][] = [];
  for (const seg of segments) {
    if (seg[0] === "M" || out.length === 0) out.push([]);
    out[out.length - 1]!.push(seg);
  }
  return out;
}

const SAMPLES = 16;

/** Points along an SVG arc (endpoint → center parameterization), excluding the start point. */
function arcSamples(x1: number, y1: number, seg: Extract<Segment, ["A", ...number[]]>, samples: number): [number, number][] {
  const [, rx0, ry0, rotation, largeArc, sweep, x2, y2] = seg;
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rx0);
  let ry = Math.abs(ry0);
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if ((largeArc !== 0) === (sweep !== 0)) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const theta = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (sweep === 0 && delta > 0) delta -= 2 * Math.PI;
  else if (sweep !== 0 && delta < 0) delta += 2 * Math.PI;
  const out: [number, number][] = [];
  for (let k = 1; k <= samples; k++) {
    const t = theta + (delta * k) / samples;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    out.push([cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]);
  }
  return out;
}

/**
 * Signed area of every subpath combined: each subpath is flattened (curves and arcs sampled at 16
 * evenly spaced parameter values) and closed back to its start. With y down, positive means
 * clockwise on screen.
 */
export function signedArea(segments: readonly Segment[]): number {
  let total = 0;
  for (const sub of subpaths(segments)) {
    const pts: [number, number][] = [];
    let current: [number, number] = [0, 0];
    let start: [number, number] = [0, 0];
    for (const seg of sub) {
      switch (seg[0]) {
        case "M":
          current = start = [seg[1], seg[2]];
          pts.push(current);
          break;
        case "L":
          current = [seg[1], seg[2]];
          pts.push(current);
          break;
        case "C": {
          const [x0, y0] = current;
          for (let k = 1; k <= SAMPLES; k++) {
            const t = k / SAMPLES;
            const u = 1 - t;
            const a = u * u * u;
            const b = 3 * u * u * t;
            const c = 3 * u * t * t;
            const d = t * t * t;
            pts.push([a * x0 + b * seg[1] + c * seg[3] + d * seg[5], a * y0 + b * seg[2] + c * seg[4] + d * seg[6]]);
          }
          current = [seg[5], seg[6]];
          break;
        }
        case "Q": {
          const [x0, y0] = current;
          for (let k = 1; k <= SAMPLES; k++) {
            const t = k / SAMPLES;
            const u = 1 - t;
            pts.push([u * u * x0 + 2 * u * t * seg[1] + t * t * seg[3], u * u * y0 + 2 * u * t * seg[2] + t * t * seg[4]]);
          }
          current = [seg[3], seg[4]];
          break;
        }
        case "A":
          for (const p of arcSamples(current[0], current[1], seg, SAMPLES)) pts.push(p);
          current = [seg[6], seg[7]];
          break;
        default:
          current = start;
      }
    }
    for (let k = 0; k < pts.length; k++) {
      const [x0, y0] = pts[k]!;
      const [x1, y1] = pts[(k + 1) % pts.length]!;
      total += x0 * y1 - x1 * y0;
    }
  }
  return total / 2;
}

/**
 * Reverse every subpath's direction, keeping subpath order. A closed subpath whose last point
 * differs from its start first gets an explicit line back to the start. Lines swap ends, cubics
 * swap controls, quadratics keep theirs, and arcs flip their sweep flag.
 */
export function reverseSubpaths(segments: readonly Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const sub of subpaths(segments)) {
    const first = sub[0]!;
    const start: [number, number] = first[0] === "M" ? [first[1], first[2]] : [0, 0];
    const closed = sub[sub.length - 1]![0] === "Z";
    const draws: { seg: Segment; from: [number, number] }[] = [];
    let current = start;
    for (const seg of sub) {
      if (seg[0] === "M" || seg[0] === "Z") continue;
      draws.push({ seg, from: current });
      current = endPoint(seg, current);
    }
    if (closed && (current[0] !== start[0] || current[1] !== start[1])) {
      draws.push({ seg: ["L", start[0], start[1]], from: current });
      current = start;
    }
    out.push(["M", current[0], current[1]]);
    for (let k = draws.length - 1; k >= 0; k--) {
      const { seg, from } = draws[k]!;
      switch (seg[0]) {
        case "L":
          out.push(["L", from[0], from[1]]);
          break;
        case "C":
          out.push(["C", seg[3], seg[4], seg[1], seg[2], from[0], from[1]]);
          break;
        case "Q":
          out.push(["Q", seg[1], seg[2], from[0], from[1]]);
          break;
        case "A":
          out.push(["A", seg[1], seg[2], seg[3], seg[4], seg[5] !== 0 ? 0 : 1, from[0], from[1]]);
          break;
      }
    }
    if (closed) out.push(["Z"]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Points and JSON
// ---------------------------------------------------------------------------

function coordinate(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** `[x, y]` (extra items ignored) or `{ x, y }` with finite numbers or numeric strings; otherwise null. */
export function readPoint(item: unknown): [number, number] | null {
  let x: unknown;
  let y: unknown;
  if (Array.isArray(item)) {
    if (item.length < 2) return null;
    x = item[0];
    y = item[1];
  } else if (isPlainObject(item)) {
    x = item.x;
    y = item.y;
  } else {
    return null;
  }
  const px = coordinate(x);
  const py = coordinate(y);
  return px === null || py === null ? null : [px, py];
}

/** JSON.parse, or undefined when the text isn't JSON. */
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// SVG markup
// ---------------------------------------------------------------------------

export interface SvgMarkup {
  /** The `d` attribute of every `<path>`, in document order. */
  paths: string[];
  /** The first `<svg>`'s viewBox, else `[0, 0, width, height]` from plain numeric sizes, else null. */
  viewBox: number[] | null;
  /** Plain-language problems, each at most once. */
  problems: string[];
}

const DRAWABLE_ELEMENTS: ReadonlySet<string> = new Set(["circle", "ellipse", "rect", "line", "polyline", "polygon", "text", "image", "use"]);
const TAG_NAME = /[A-Za-z_][\w:.-]*/y;
const ATTRIBUTE = /\s*([^\s=>/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/y;
const PLAIN_SIZE = /^\s*([+]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(?:px)?\s*$/;

function parseViewBox(value: string | undefined): number[] | null {
  if (value === undefined || value.trim() === "") return null;
  const parts = value.trim().split(/[\s,]+/);
  if (parts.length !== 4) return null;
  const numbers = parts.map(Number);
  return numbers.every(Number.isFinite) ? numbers : null;
}

function plainSize(value: string | undefined): number | null {
  const m = value === undefined ? null : PLAIN_SIZE.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Read `<path>` data, the viewBox, and unsupported content from SVG markup, with no DOM and no entity expansion. */
export function readSvgMarkup(text: string): SvgMarkup {
  const paths: string[] = [];
  let viewBox: number[] | null = null;
  let sawSvg = false;
  let sawPath = false;
  let otherShapes = false;
  let transforms = false;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt < 0) break;
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      i = end < 0 ? n : end + 3;
      continue;
    }
    const next = text[lt + 1];
    if (next === "/" || next === "?" || next === "!") {
      const end = text.indexOf(">", lt + 1);
      i = end < 0 ? n : end + 1;
      continue;
    }
    TAG_NAME.lastIndex = lt + 1;
    const name = TAG_NAME.exec(text);
    if (!name) {
      i = lt + 1;
      continue;
    }
    let j = TAG_NAME.lastIndex;
    const attributes = new Map<string, string>();
    for (;;) {
      ATTRIBUTE.lastIndex = j;
      const m = ATTRIBUTE.exec(text);
      if (!m) break;
      j = ATTRIBUTE.lastIndex;
      const key = m[1]!.toLowerCase();
      if (!attributes.has(key)) attributes.set(key, m[2] ?? m[3] ?? m[4] ?? "");
    }
    const end = text.indexOf(">", j);
    i = end < 0 ? n : end + 1;

    const raw = name[0];
    const element = raw.slice(raw.lastIndexOf(":") + 1).toLowerCase();
    if (element === "svg" && !sawSvg) {
      sawSvg = true;
      viewBox = parseViewBox(attributes.get("viewbox"));
      if (!viewBox) {
        const w = plainSize(attributes.get("width"));
        const h = plainSize(attributes.get("height"));
        viewBox = w !== null && h !== null ? [0, 0, w, h] : null;
      }
    } else if (element === "path") {
      sawPath = true;
      const d = attributes.get("d");
      if (d !== undefined) paths.push(d);
    } else if (DRAWABLE_ELEMENTS.has(element)) {
      otherShapes = true;
    }
    if (attributes.has("transform")) transforms = true;
  }
  const problems: string[] = [];
  if (otherShapes) problems.push("Only <path> elements are read; flatten other shapes before copying.");
  if (transforms) problems.push("Transforms in the SVG are ignored; flatten the artwork before copying.");
  if (!sawPath) problems.push("The SVG has no <path> elements.");
  return { paths, viewBox, problems };
}
