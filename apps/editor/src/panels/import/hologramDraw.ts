/**
 * Drawing for the import hologram, shared by the Import Design dialog's scanner, the canvas build and
 * the Viewer's device screen: the veil, a faint grid, pixel rain, the laser, the frame, and wireframes.
 * Everything draws in CSS pixels into a 2D context already scaled for devicePixelRatio. Colors come
 * from the --holo-* tokens (hologram.css), read once per run.
 */

import type { Rect } from "../canvas/geometry.ts";
import { HOLO, traceProgress, type HoloFrame, type HoloPiece, type HoloPlan, type HoloShape, type Radii } from "./hologramPlan.ts";

export type RGB = readonly [number, number, number];

export interface HoloColors {
  /** The veil over the design (top and bottom of its gradient). */
  veilTop: RGB;
  veilBottom: RGB;
  /** Wireframes, the frame, rain, and the laser's glow. */
  line: RGB;
  /** The laser's core and the brightest pixels. */
  core: RGB;
  /** The secondary blue that deeper wireframes drift toward. */
  tint: RGB;
  /** The magenta fringe beside the laser and at the reveal edge. */
  fringe: RGB;
  rain: RGB;
  /** The frame's outline and corners, which also sit on the UI around it. */
  edge: RGB;
  /** The closing bloom just outside the frame, on the UI around it: its color, peak opacity and hairline. */
  halo: RGB;
  haloAlpha: number;
  haloLine: RGB;
  /** How strongly the veil's grid shows (0–1). */
  gridAlpha: number;
  /** Wireframe stroke opacity once traced. */
  wireAlpha: number;
}

const DEFAULT_COLORS: HoloColors = {
  veilTop: [7, 22, 33],
  veilBottom: [3, 10, 17],
  line: [94, 242, 255],
  core: [230, 254, 255],
  tint: [122, 132, 255],
  fringe: [255, 95, 210],
  rain: [63, 224, 240],
  edge: [232, 254, 255],
  halo: [94, 242, 255],
  haloAlpha: 0.36,
  haloLine: [160, 248, 255],
  gridAlpha: 0.09,
  wireAlpha: 0.62,
};

function parseColor(value: string): RGB | null {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/** The --holo-* tokens as they apply to `el` (its theme). */
export function readHoloColors(el: Element): HoloColors {
  let style: CSSStyleDeclaration;
  try {
    style = getComputedStyle(el);
  } catch {
    return DEFAULT_COLORS;
  }
  const color = (name: string, fallback: RGB) => parseColor(style.getPropertyValue(name)) ?? fallback;
  const number = (name: string, fallback: number) => {
    const n = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    veilTop: color("--holo-veil-top", DEFAULT_COLORS.veilTop),
    veilBottom: color("--holo-veil-bottom", DEFAULT_COLORS.veilBottom),
    line: color("--holo-line", DEFAULT_COLORS.line),
    core: color("--holo-core", DEFAULT_COLORS.core),
    tint: color("--holo-tint", DEFAULT_COLORS.tint),
    fringe: color("--holo-fringe", DEFAULT_COLORS.fringe),
    rain: color("--holo-rain", DEFAULT_COLORS.rain),
    edge: color("--holo-edge", DEFAULT_COLORS.edge),
    halo: color("--holo-halo", DEFAULT_COLORS.halo),
    haloAlpha: number("--holo-halo-alpha", DEFAULT_COLORS.haloAlpha),
    haloLine: color("--holo-halo-line", DEFAULT_COLORS.haloLine),
    gridAlpha: number("--holo-grid-alpha", DEFAULT_COLORS.gridAlpha),
    wireAlpha: number("--holo-wire-alpha", DEFAULT_COLORS.wireAlpha),
  };
}

export const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

export function mixColor(a: RGB, b: RGB, t: number): RGB {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

/**
 * True when the app or the OS asks for reduced motion: :root[data-reduced-motion="true"], else
 * Settings → Motion (<html data-motion>, which follows the OS unless the person picked Full or
 * Reduced), else the OS setting.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  const root = document.documentElement;
  if (root.getAttribute("data-reduced-motion") === "true") return true;
  const motion = root.getAttribute("data-motion");
  if (motion === "reduce" || motion === "full") return motion === "reduce";
  try {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Size a canvas's backing store for `width` × `height` CSS pixels; returns the device pixel ratio. */
export function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number): number {
  const dpr = Math.min(3, Math.max(1, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1));
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return dpr;
}

/** A stable pseudo-random number in [0, 1) for integer inputs (no Math.random: frames replay alike). */
export function hash01(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The rain's cell size in CSS pixels for a rect: finer for small screens. */
export function rainCell(r: Rect): number {
  return Math.max(3, Math.min(6, Math.round(Math.min(r.width, r.height * 0.6) / 44)));
}

export function drawVeil(ctx: CanvasRenderingContext2D, r: Rect, c: HoloColors): void {
  const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.height);
  g.addColorStop(0, rgba(c.veilTop, 1));
  g.addColorStop(1, rgba(c.veilBottom, 1));
  ctx.fillStyle = g;
  ctx.fillRect(r.x, r.y, r.width, r.height);
}

/** A faint grid on the rain's lattice, every four cells from `origin`. */
export function drawGrid(ctx: CanvasRenderingContext2D, r: Rect, c: HoloColors, origin: Rect = r, alpha = 1): void {
  const step = rainCell(origin) * 4;
  ctx.beginPath();
  for (let x = origin.x + step; x < r.x + r.width; x += step) {
    if (x <= r.x) continue;
    const px = Math.round(x) + 0.5;
    ctx.moveTo(px, r.y);
    ctx.lineTo(px, r.y + r.height);
  }
  for (let y = origin.y + step; y < r.y + r.height; y += step) {
    if (y <= r.y) continue;
    const py = Math.round(y) + 0.5;
    ctx.moveTo(r.x, py);
    ctx.lineTo(r.x + r.width, py);
  }
  ctx.strokeStyle = rgba(c.line, c.gridAlpha * alpha);
  ctx.lineWidth = 1;
  ctx.stroke();
}

export interface RainOptions {
  /** Changes the pattern. */
  seed?: number;
  /** Only draw pixels above this y (CSS px): the veil's edge while the design materializes. */
  bottom?: number;
  /** Scales every pixel's opacity. */
  alpha?: number;
  /** Pixels between these heights (CSS px) show at `alpha`: the part the laser has already scanned. */
  dim?: { top: number; bottom: number; alpha: number };
}

const DROPS_PER_COLUMN = 2;
/** Opacity levels the rain's pixels are drawn at. */
const RAIN_LEVELS = 10;

/**
 * Pixel rain: small squares falling down columns on a lattice, each drop a bright head and a fading
 * trail. Positions are a pure function of time, so nothing is kept between frames.
 */
export function drawRain(ctx: CanvasRenderingContext2D, r: Rect, seconds: number, c: HoloColors, options: RainOptions = {}): void {
  const seed = options.seed ?? 1;
  const alpha = options.alpha ?? 1;
  const dim = options.dim ?? { top: 0, bottom: 0, alpha: 1 };
  const shade = (y: number) => (y >= dim.top && y < dim.bottom ? dim.alpha : 1);
  const cell = rainCell(r);
  const size = Math.max(1.5, cell - (cell >= 5 ? 2 : 1));
  const inset = (cell - size) / 2;
  const cols = Math.floor(r.width / cell);
  const rows = Math.ceil(r.height / cell);
  if (cols <= 0 || rows <= 0) return;
  const x0 = r.x + (r.width - cols * cell) / 2;
  const bottomRow = options.bottom === undefined ? rows : Math.min(rows, Math.floor((options.bottom - r.y) / cell));
  // Pixels batch into a few opacity levels: one fill per level instead of one per pixel.
  const trails = Array.from({ length: RAIN_LEVELS }, () => new Path2D());
  const heads = Array.from({ length: RAIN_LEVELS }, () => new Path2D());
  const level = (a: number) => Math.min(RAIN_LEVELS - 1, Math.round(a * (RAIN_LEVELS - 1)));
  for (let col = 0; col < cols; col++) {
    for (let d = 0; d < DROPS_PER_COLUMN; d++) {
      const speed = rows * (0.34 + 0.5 * hash01(seed, col, d * 7 + 1));
      const trail = 4 + Math.floor(hash01(seed, col, d * 7 + 2) * 10);
      const gap = 0.35 + 2.1 * hash01(seed, col, d * 7 + 3);
      const period = (rows + trail) / speed + gap;
      const local = (seconds + hash01(seed, col, d * 7 + 4) * period) % period;
      const head = Math.floor(local * speed);
      if (head - trail >= rows) continue;
      const brightness = 0.45 + 0.55 * hash01(seed, col, d * 7 + 5);
      const x = x0 + col * cell + inset;
      for (let i = 1; i <= trail; i++) {
        const row = head - i;
        if (row < 0 || row >= bottomRow) continue;
        const y = r.y + row * cell + inset;
        const a = brightness * 0.7 * (1 - i / (trail + 1)) ** 1.7 * shade(y);
        if (a > 0.02) trails[level(a)]!.rect(x, y, size, size);
      }
      if (head >= 0 && head < bottomRow) {
        const y = r.y + head * cell + inset;
        heads[level(0.3 + 0.7 * brightness * shade(y))]!.rect(x, y, size, size);
      }
    }
  }
  ctx.fillStyle = rgba(c.rain, 1);
  trails.forEach((path, i) => {
    ctx.globalAlpha = (alpha * i) / (RAIN_LEVELS - 1);
    ctx.fill(path);
  });
  // Heads glow cyan: a halo in the line color around a cyan-white pixel.
  ctx.lineWidth = Math.max(1, cell * 0.34);
  ctx.strokeStyle = rgba(c.line, 0.32);
  ctx.fillStyle = rgba(mixColor(c.line, c.core, 0.4), 1);
  heads.forEach((path, i) => {
    ctx.globalAlpha = (alpha * i) / (RAIN_LEVELS - 1);
    ctx.stroke(path);
    ctx.fill(path);
  });
  ctx.globalAlpha = 1;
}

/**
 * The laser across a rect at `y`: a soft light sheet on the side it came from, a glow, a thin magenta
 * fringe, the bright core reaching a little past the frame, and emitter flares at both ends.
 */
export function drawLaser(ctx: CanvasRenderingContext2D, r: Rect, y: number, direction: 1 | -1, c: HoloColors, options: { sheet?: boolean; intensity?: number } = {}): void {
  // Its gradient stops come from the rect's size: an empty rect has no laser.
  if (!(r.width > 0) || !(r.height > 0)) return;
  const k = options.intensity ?? 1;
  const ext = Math.min(12, Math.max(4, r.width * 0.05));
  const left = r.x - ext;
  const right = r.x + r.width + ext;
  if (options.sheet !== false) {
    // The light sheet stays inside the frame, on the side the laser came from.
    const depth = Math.min(64, Math.max(14, r.height * 0.16));
    const top = direction > 0 ? Math.max(r.y, y - depth) : y;
    const bottom = direction > 0 ? y : Math.min(r.y + r.height, y + depth);
    const sheet = ctx.createLinearGradient(0, y, 0, y - direction * depth);
    sheet.addColorStop(0, rgba(c.line, 0.2 * k));
    sheet.addColorStop(0.35, rgba(c.line, 0.07 * k));
    sheet.addColorStop(1, rgba(c.line, 0));
    ctx.fillStyle = sheet;
    if (bottom > top) ctx.fillRect(r.x, top, r.width, bottom - top);
  }
  const glowH = Math.min(9, Math.max(4, r.height * 0.02));
  const glow = ctx.createLinearGradient(0, y - glowH, 0, y + glowH);
  glow.addColorStop(0, rgba(c.line, 0));
  glow.addColorStop(0.5, rgba(c.line, 0.5 * k));
  glow.addColorStop(1, rgba(c.line, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(r.x, y - glowH, r.width, glowH * 2);
  // Chromatic fringe, trailing the core by a pixel and a half.
  ctx.fillStyle = rgba(c.fringe, 0.45 * k);
  ctx.fillRect(r.x, y - direction * 1.75 - 0.5, r.width, 1);
  const core = ctx.createLinearGradient(left, 0, right, 0);
  core.addColorStop(0, rgba(c.core, 0));
  core.addColorStop(ext / (right - left), rgba(c.core, k));
  core.addColorStop(1 - ext / (right - left), rgba(c.core, k));
  core.addColorStop(1, rgba(c.core, 0));
  ctx.fillStyle = core;
  ctx.fillRect(left, y - 0.75, right - left, 1.5);
  for (const x of [r.x, r.x + r.width]) {
    const flare = ctx.createRadialGradient(x, y, 0, x, y, glowH);
    flare.addColorStop(0, rgba(c.core, 0.95 * k));
    flare.addColorStop(0.3, rgba(c.line, 0.55 * k));
    flare.addColorStop(1, rgba(c.line, 0));
    ctx.fillStyle = flare;
    ctx.fillRect(x - glowH, y - glowH, glowH * 2, glowH * 2);
  }
}

/** The just-revealed design below the laser as it sweeps back up: tinted and scanlined for a moment. */
export function drawRevealEdge(ctx: CanvasRenderingContext2D, screen: Rect, y: number, c: HoloColors): void {
  const band = Math.min(48, Math.max(12, screen.height * 0.14));
  const tint = ctx.createLinearGradient(0, y, 0, y + band);
  tint.addColorStop(0, rgba(c.line, 0.34));
  tint.addColorStop(0.45, rgba(c.tint, 0.12));
  tint.addColorStop(1, rgba(c.tint, 0));
  ctx.fillStyle = tint;
  ctx.fillRect(screen.x, y, screen.width, band);
  ctx.fillStyle = rgba(c.core, 1);
  for (let sy = y + 2; sy < y + band; sy += 3) {
    ctx.globalAlpha = 0.22 * (1 - (sy - y) / band);
    ctx.fillRect(screen.x, Math.round(sy), screen.width, 1);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = rgba(c.fringe, 0.4);
  ctx.fillRect(screen.x, y + 2, screen.width, 1);
}

/** Corner radii clockwise from the top left, each fitting `r`. */
export function fitRadii(r: Rect, radius: number | Radii): [number, number, number, number] {
  const max = Math.max(0, Math.min(r.width, r.height) / 2);
  const all = typeof radius === "number" ? [radius, radius, radius, radius] : radius;
  return all.map((v) => Math.max(0, Math.min(v, max))) as [number, number, number, number];
}

/**
 * Segments for a quarter circle of radius `rad` (CSS px) while an outline traces: about 2.5 px each,
 * so a corner stays round at any zoom (an 900% avatar's 100 px corner as much as a 4 px chip's).
 */
export function cornerSteps(rad: number): number {
  return Math.max(4, Math.min(64, Math.ceil((Math.PI * rad) / 2 / 2.5)));
}

/** Points around a rounded rect, clockwise from the middle of its top edge, closed. */
export function perimeterPoints(r: Rect, radius: number | Radii): [number, number][] {
  const [tl, tr, br, bl] = fitRadii(r, radius);
  const { x, y, width: w, height: h } = r;
  const pts: [number, number][] = [[x + w / 2, y]];
  const corner = (cx: number, cy: number, rad: number, from: number) => {
    if (rad < 0.5) {
      pts.push([cx + Math.cos(from + Math.PI / 4) * rad * Math.SQRT2, cy + Math.sin(from + Math.PI / 4) * rad * Math.SQRT2]);
      return;
    }
    const steps = cornerSteps(rad);
    for (let i = 0; i <= steps; i++) {
      const a = from + (Math.PI / 2) * (i / steps);
      pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }
  };
  corner(x + w - tr, y + tr, tr, -Math.PI / 2);
  corner(x + w - br, y + h - br, br, 0);
  corner(x + bl, y + h - bl, bl, Math.PI / 2);
  corner(x + tl, y + tl, tl, Math.PI);
  pts.push([x + w / 2, y]);
  return pts;
}

/**
 * Add the first `length` pixels of a closed polyline to a path, walking forward or backward
 * from its first point; returns where it stopped.
 */
function walk(ctx: CanvasPath, pts: readonly [number, number][], length: number, backward: boolean): [number, number] {
  const n = pts.length - 1;
  const at = (i: number) => pts[backward ? n - i : i]!;
  let [px, py] = at(0);
  ctx.moveTo(px, py);
  let left = length;
  for (let i = 1; i <= n; i++) {
    const [qx, qy] = at(i);
    const seg = Math.hypot(qx - px, qy - py);
    if (seg >= left) {
      const f = seg === 0 ? 0 : left / seg;
      const ex = px + (qx - px) * f;
      const ey = py + (qy - py) * f;
      ctx.lineTo(ex, ey);
      return [ex, ey];
    }
    ctx.lineTo(qx, qy);
    left -= seg;
    px = qx;
    py = qy;
  }
  return [px, py];
}

function polylineLength(pts: readonly [number, number][]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return total;
}

/**
 * Add a rounded rect's outline to a path (a context's current path or a Path2D), traced `p` (0–1) of the way: both halves grow from
 * the middle of the top edge and meet at the bottom. Returns the two tips while it's still tracing.
 */
export function traceOutline(ctx: CanvasPath, r: Rect, radius: number | Radii, p: number): [number, number][] {
  if (p >= 1) {
    roundedRect(ctx, r, radius);
    return [];
  }
  if (p <= 0) return [];
  const pts = perimeterPoints(r, radius);
  const half = (polylineLength(pts) / 2) * p;
  return [walk(ctx, pts, half, false), walk(ctx, pts, half, true)];
}

/** An ellipse's outline traced `p` of the way, both halves from its top. */
export function traceOval(ctx: CanvasPath, r: Rect, p: number): [number, number][] {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const rx = r.width / 2;
  const ry = r.height / 2;
  if (p >= 1) {
    ctx.moveTo(cx + rx, cy);
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    return [];
  }
  if (p <= 0) return [];
  const top = -Math.PI / 2;
  const sweep = Math.PI * p;
  ctx.moveTo(cx, cy - ry);
  ctx.ellipse(cx, cy, rx, ry, 0, top, top + sweep);
  ctx.moveTo(cx, cy - ry);
  ctx.ellipse(cx, cy, rx, ry, 0, top, top - sweep, true);
  return [
    [cx + Math.cos(top + sweep) * rx, cy + Math.sin(top + sweep) * ry],
    [cx + Math.cos(top - sweep) * rx, cy + Math.sin(top - sweep) * ry],
  ];
}

/** An image's X, drawn from its top corners once the outline is well along (inside rounded corners). */
export function traceCross(ctx: CanvasPath, r: Rect, p: number, radius: number | Radii = 0): void {
  const q = Math.max(0, Math.min(1, (p - 0.35) / 0.65));
  if (q <= 0) return;
  // Each arm ends where its diagonal meets the rounded corner.
  const pad = Math.min(r.width, r.height) > 12 ? 2 : 0;
  const [tl, tr, br, bl] = fitRadii(r, radius).map((rad) => Math.max(pad, rad * (1 - Math.SQRT1_2)));
  const arm = (ax: number, ay: number, bx: number, by: number) => {
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + (bx - ax) * q, ay + (by - ay) * q);
  };
  arm(r.x + tl!, r.y + tl!, r.x + r.width - br!, r.y + r.height - br!);
  arm(r.x + r.width - tr!, r.y + tr!, r.x + bl!, r.y + r.height - bl!);
}

/** How thick a text line bar may get, in CSS px: a few outline weights (outlines are 1 px at any zoom). */
export const TEXT_BAR_MAX = 3.5;

/**
 * A text line bar's thickness for a line `lineHeight` CSS px tall: under half the line, but never
 * past TEXT_BAR_MAX, so zoomed in, text reads as thin lines beside the 1 px outlines, not as pills.
 */
export function textBarThickness(lineHeight: number): number {
  return Math.max(1.25, Math.min(TEXT_BAR_MAX, lineHeight * 0.44));
}

/** Text as 1–3 line bars growing from the left (the last one shorter), added as rects to the path. */
export function textBars(ctx: CanvasPath, r: Rect, lines: number, p: number): void {
  const n = Math.max(1, lines);
  const lh = r.height / n;
  const thick = textBarThickness(lh);
  for (let i = 0; i < n; i++) {
    // Each line starts a little after the one above it.
    const q = Math.max(0, Math.min(1, (p - i * 0.18) / (1 - (n - 1) * 0.18)));
    if (q <= 0) continue;
    const eased = 1 - (1 - q) ** 3;
    const full = r.width * (n > 1 && i === n - 1 ? 0.62 : 1);
    const w = Math.max(thick, full * eased);
    const y = r.y + i * lh + (lh - thick) / 2;
    if (ctx.roundRect) ctx.roundRect(r.x, y, w, thick, thick / 2);
    else ctx.rect(r.x, y, w, thick);
  }
}

export interface FrameOptions {
  /** How far the outline has traced (0–1). */
  trace?: number;
  /** The closing bloom outside the frame (0–1). */
  glow?: number;
  /** The outline's strength (0–1): closing, it hands the screen over to its selection outline. */
  outline?: number;
  /** How far the outline has moved out to the bloom's hairline (0–1), taking on its color on the way. */
  spread?: number;
  /** Viewfinder corners, and how strongly they show (0–1). */
  brackets?: boolean | number;
  /** The screen's corners in CSS px: the outline, the corners and the bloom follow them. */
  radii?: Radii;
}

/**
 * The closing bloom's shape outside the screen edge, in CSS px: a hairline `gap` out (clear of the
 * selection outline's 8 px corner handles), and a soft band that brightens just past it and fades out
 * by `reach` (all less around a small screen: bloomGap, bloomReach).
 */
export const BLOOM = { gap: 5, peak: 8, reach: 30 } as const;

/** How far the bloom reaches around a screen `width` × `height` CSS px: a third of its short side, 14–30 px. */
export function bloomReach(width: number, height: number): number {
  return Math.max(14, Math.min(BLOOM.reach, Math.min(width, height) / 3));
}

/** How far out the bloom's hairline sits: BLOOM.gap, closer around a screen under 60 px across (2.5 px at the least). */
export function bloomGap(width: number, height: number): number {
  return Math.max(2.5, Math.min(BLOOM.gap, Math.min(width, height) / 12));
}

/** A rounded rect's corners grown by `d` (concentric): a square corner stays square. */
export function growRadii(radii: readonly number[], d: number): [number, number, number, number] {
  return [0, 1, 2, 3].map((i) => ((radii[i] ?? 0) > 0 ? Math.max(0, radii[i]! + d) : 0)) as [number, number, number, number];
}

/** Add a rect with these corners to a path (a plain rect when every corner is square). */
export function roundedRect(ctx: CanvasPath, r: Rect, radii: number | Radii): void {
  const fitted = fitRadii(r, radii);
  if (fitted.some((v) => v >= 0.5) && ctx.roundRect) ctx.roundRect(r.x, r.y, r.width, r.height, fitted);
  else ctx.rect(r.x, r.y, r.width, r.height);
}

/**
 * The closing bloom: light spilling out of the frame rather than another stroke on it. A wide soft
 * band of gradients at low alpha, outside the screen and following its corners, never over the design
 * it just revealed. `glow` (0–1) scales it.
 */
export function drawBloom(ctx: CanvasRenderingContext2D, r: Rect, c: HoloColors, glow: number, radii: number | Radii = 0): void {
  if (glow <= 0 || !(r.width > 0) || !(r.height > 0)) return;
  const reach = bloomReach(r.width, r.height);
  const gap = bloomGap(r.width, r.height);
  const peak = gap * (BLOOM.peak / BLOOM.gap);
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  const right = Math.round(r.x + r.width);
  const bottom = Math.round(r.y + r.height);
  const [tl, tr, br, bl] = fitRadii({ x, y, width: right - x, height: bottom - y }, radii);
  const a = c.haloAlpha * glow;
  // One falloff for every side and corner: nothing at the edge, brightest just past the hairline, a long tail.
  const stops: [number, number][] = [
    [0, 0],
    [gap / reach, a * 0.55],
    [peak / reach, a],
    [(peak + (reach - peak) * 0.35) / reach, a * 0.42],
    [1, 0],
  ];
  const paint = (g: CanvasGradient) => {
    for (const [at, alpha] of stops) g.addColorStop(at, rgba(c.halo, alpha));
    ctx.fillStyle = g;
  };
  const side = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
    if (rw <= 0 || rh <= 0) return;
    paint(ctx.createLinearGradient(x0, y0, x1, y1));
    ctx.fillRect(rx, ry, rw, rh);
  };
  side(0, y, 0, y - reach, x + tl, y - reach, right - tr - (x + tl), reach);
  side(0, bottom, 0, bottom + reach, x + bl, bottom, right - br - (x + bl), reach);
  side(x, 0, x - reach, 0, x - reach, y + tl, reach, bottom - bl - (y + tl));
  side(right, 0, right + reach, 0, right, y + tr, reach, bottom - br - (y + tr));
  // Corners fall off around their arcs' centers, from the arc outward (nothing inside it).
  for (const [cx, cy, rad, dx, dy] of [
    [x + tl, y + tl, tl, -1, -1],
    [right - tr, y + tr, tr, 1, -1],
    [right - br, bottom - br, br, 1, 1],
    [x + bl, bottom - bl, bl, -1, 1],
  ] as const) {
    paint(ctx.createRadialGradient(cx, cy, rad, cx, cy, rad + reach));
    const size = rad + reach;
    ctx.fillRect(dx < 0 ? cx - size : cx, dy < 0 ? cy - size : cy, size, size);
  }
}

/** The line's opacity on the screen's edge, and once it has moved out to the bloom's hairline. */
const OUTLINE_ALPHA = 0.78;
const hairlineAlpha = (c: HoloColors) => Math.min(1, c.haloAlpha * 2.4);

/**
 * The hologram's frame: a glowing outline with viewfinder corners in the edge color. Closing, the
 * outline moves out to the bloom's hairline (`spread`), thinning to it, and fades there.
 */
export function drawFrame(ctx: CanvasRenderingContext2D, r: Rect, c: HoloColors, options: FrameOptions = {}): void {
  const trace = options.trace ?? 1;
  const strength = options.outline ?? 1;
  const spread = Math.max(0, Math.min(1, options.spread ?? 0));
  const radii = fitRadii(r, options.radii ?? 0);
  drawBloom(ctx, r, c, options.glow ?? 0, radii);
  if (strength > 0) {
    // Crisp: on the screen's edge pixels, then whole pixels further out.
    const d = spread * bloomGap(r.width, r.height);
    const x = Math.round(r.x);
    const y = Math.round(r.y);
    const outline = { x: x + 0.5 - d, y: y + 0.5 - d, width: Math.round(r.x + r.width) - x - 1 + d * 2, height: Math.round(r.y + r.height) - y - 1 + d * 2 };
    ctx.beginPath();
    const tips = traceOutline(ctx, outline, growRadii(radii, d - 0.5), trace);
    const color = mixColor(c.line, c.haloLine, spread);
    ctx.lineJoin = "miter";
    ctx.strokeStyle = rgba(color, 0.16 * strength * (1 - spread));
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = rgba(color, (OUTLINE_ALPHA + (hairlineAlpha(c) - OUTLINE_ALPHA) * spread) * strength);
    ctx.lineWidth = 1;
    ctx.stroke();
    drawTips(ctx, tips, c);
  }
  const brackets = options.brackets === undefined || options.brackets === true ? 1 : options.brackets === false ? 0 : options.brackets;
  if (brackets <= 0 || trace < 1) return;
  const len = Math.max(5, Math.min(16, Math.min(r.width, r.height) * 0.09));
  const { x, y, width: w, height: h } = r;
  // Each corner runs a little way along both edges; a rounded corner follows its curve.
  const arm = (rad: number) => (rad > 0 ? Math.min(rad + len * 0.6, Math.min(w, h) / 2) : len);
  const [tl, tr, br, bl] = radii;
  ctx.beginPath();
  ctx.moveTo(x, y + arm(tl));
  ctx.arcTo(x, y, x + arm(tl), y, tl);
  ctx.lineTo(x + arm(tl), y);
  ctx.moveTo(x + w - arm(tr), y);
  ctx.arcTo(x + w, y, x + w, y + arm(tr), tr);
  ctx.lineTo(x + w, y + arm(tr));
  ctx.moveTo(x + w, y + h - arm(br));
  ctx.arcTo(x + w, y + h, x + w - arm(br), y + h, br);
  ctx.lineTo(x + w - arm(br), y + h);
  ctx.moveTo(x + arm(bl), y + h);
  ctx.arcTo(x, y + h, x, y + h - arm(bl), bl);
  ctx.lineTo(x, y + h - arm(bl));
  ctx.lineCap = "square";
  ctx.strokeStyle = rgba(c.edge, 0.92 * brackets);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.lineCap = "butt";
}

/** Bright points at the leading ends of outlines still tracing. */
export function drawTips(ctx: CanvasRenderingContext2D, tips: readonly [number, number][], c: HoloColors, size = 1.6): void {
  if (!tips.length) return;
  ctx.fillStyle = rgba(c.line, 0.35);
  ctx.beginPath();
  for (const [x, y] of tips) {
    ctx.moveTo(x + size * 2.4, y);
    ctx.arc(x, y, size * 2.4, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = rgba(c.core, 1);
  ctx.beginPath();
  for (const [x, y] of tips) {
    ctx.moveTo(x + size, y);
    ctx.arc(x, y, size, 0, Math.PI * 2);
  }
  ctx.fill();
}

/** How long a traced outline stays brighter than the rest. */
const FRESH_MS = 420;
/** How brightly the rain falls where the laser has already scanned. */
const SCANNED_RAIN = 0.42;
/** Wireframe colors by depth: cyan drifting toward the secondary blue. */
const DEPTH_BUCKETS = 4;

/** Wireframe colors by depth, from the line color toward the secondary blue. */
export function depthColors(c: HoloColors): RGB[] {
  return Array.from({ length: DEPTH_BUCKETS }, (_, i) => mixColor(c.line, c.tint, (i / (DEPTH_BUCKETS - 1)) * 0.75));
}

/** How far below the laser the wireframe may reach while it sweeps down (CSS px). */
export function laserLead(screen: Rect): number {
  return Math.min(10, Math.max(3, screen.height * 0.012));
}

export interface BuildFrame {
  plan: HoloPlan;
  frame: HoloFrame;
  t: number;
  /** The screen in the context's CSS pixels: where the veil, the rain and the laser go. */
  screen: Rect;
  /** A plan rect (the plan's points) in the context's CSS pixels. */
  toScreen: (r: Rect) => Rect;
  colors: HoloColors;
  /** depthColors(colors). */
  depths: readonly RGB[];
  seed: number;
  /** Draw the frame's outline, corners and closing bloom (default true): not where a device's edge frames the screen. */
  edge?: boolean;
}

/** One frame of the build: veil, grid and rain; wireframes; the reveal edge; the laser; the frame. */
export function drawBuildFrame(ctx: CanvasRenderingContext2D, { plan, frame, t, screen, toScreen, colors, depths, seed, edge = true }: BuildFrame): void {
  const zoom = plan.screen.width > 0 ? toScreen(plan.screen).width / plan.screen.width : 1;
  const radii = scaleRadii(plan.radii, zoom);
  const laserY = frame.laser === null ? null : screen.y + screen.height * frame.laser;
  ctx.save();
  ctx.beginPath();
  roundedRect(ctx, screen, radii);
  ctx.clip();

  if (frame.veil > 0) {
    const bottom = screen.y + screen.height * frame.veil;
    ctx.save();
    ctx.beginPath();
    ctx.rect(screen.x, screen.y, screen.width, bottom - screen.y);
    ctx.clip();
    drawVeil(ctx, screen, colors);
    drawGrid(ctx, screen, colors);
    // The rain calms where the laser has scanned, so the wireframe reads.
    const scanned = frame.phase === "power" ? -Infinity : frame.phase === "down" && laserY !== null ? laserY : Infinity;
    if (!plan.reduced) drawRain(ctx, screen, t / 1000, colors, { seed, bottom, alpha: frame.phase === "power" ? Math.min(1, t / HOLO.powerMs) : 1, dim: { top: -Infinity, bottom: scanned, alpha: SCANNED_RAIN } });
    ctx.restore();
  }

  if (frame.phase === "down" && laserY !== null) {
    // The laser prints the wireframe: outlines race along their top edges, but their sides only
    // reach as far as the laser has scanned.
    ctx.save();
    ctx.beginPath();
    ctx.rect(screen.x, screen.y, screen.width, laserY + laserLead(screen) - screen.y);
    ctx.clip();
    drawWires(ctx, plan, t, toScreen, colors, depths);
    ctx.restore();
  } else if (frame.phase !== "glow") {
    drawWires(ctx, plan, t, toScreen, colors, depths);
  }

  if (frame.phase === "up" && laserY !== null) {
    // Wireframes fade out behind the laser as the design materializes.
    const fade = Math.min(96, Math.max(24, screen.height * 0.22));
    ctx.globalCompositeOperation = "destination-out";
    const erase = ctx.createLinearGradient(0, laserY, 0, laserY + fade);
    erase.addColorStop(0, "rgba(0,0,0,0)");
    erase.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = erase;
    ctx.fillRect(screen.x, laserY, screen.width, fade);
    ctx.fillStyle = "#000";
    ctx.fillRect(screen.x, laserY + fade, screen.width, Math.max(0, screen.y + screen.height - laserY - fade));
    ctx.globalCompositeOperation = "source-over";
    drawRevealEdge(ctx, screen, laserY, colors);
  }
  ctx.restore();

  if (laserY !== null) drawLaser(ctx, screen, Math.min(screen.y + screen.height - 0.75, Math.max(screen.y + 0.75, laserY)), frame.direction, colors, { intensity: frame.phase === "hold" ? 0.85 : 1 });
  // Closing, the outline moves out to the bloom's hairline and fades as the bloom swells, and its
  // viewfinder corners go with it: one line at a time, gone before the selection outline comes back.
  if (edge) drawFrame(ctx, screen, colors, { trace: frame.frame, glow: frame.glow, outline: frame.outline, spread: frame.spread, brackets: frame.outline * (1 - frame.spread) ** 2, radii });
}

const scaleRadii = ([tl, tr, br, bl]: Radii, k: number): Radii => [tl * k, tr * k, br * k, bl * k];

function wirePath(ctx: CanvasPath, piece: HoloPiece, r: Rect, p: number, zoom: number): [number, number][] {
  if (piece.shape === "oval") return traceOval(ctx, r, p);
  const radii = scaleRadii(piece.radii, zoom);
  const tips = traceOutline(ctx, r, radii, p);
  if (piece.shape === "image") traceCross(ctx, r, p, radii);
  return tips;
}

/** Crisp 1px lines: outlines sit on half pixels. */
const crispRect = (r: Rect): Rect => ({ x: Math.round(r.x) + 0.5, y: Math.round(r.y) + 0.5, width: Math.max(1, Math.round(r.width) - 1), height: Math.max(1, Math.round(r.height) - 1) });

function drawWires(ctx: CanvasRenderingContext2D, plan: HoloPlan, t: number, toScreen: (r: Rect) => Rect, c: HoloColors, depths: readonly RGB[]): void {
  const zoom = plan.screen.width > 0 ? toScreen(plan.screen).width / plan.screen.width : 1;
  const settledLines = depths.map(() => new Path2D());
  const settledBars = depths.map(() => new Path2D());
  const fresh: { piece: HoloPiece; r: Rect; p: number; glow: number; bucket: number }[] = [];
  let any = false;
  for (const piece of plan.pieces) {
    const p = traceProgress(piece, t, plan.reduced);
    if (p <= 0) continue;
    const r = toScreen(piece.rect);
    if (r.width < 0.75 || r.height < 0.75) continue;
    const bucket = Math.min(depths.length - 1, piece.depth - 1);
    const glow = plan.reduced ? 0 : 1 - Math.min(1, Math.max(0, (t - piece.at - HOLO.traceMs) / FRESH_MS));
    if (p < 1 || glow > 0) {
      fresh.push({ piece, r, p, glow, bucket });
      continue;
    }
    any = true;
    if (piece.shape === "text") textBars(settledBars[bucket]!, r, piece.lines, 1);
    else wirePath(settledLines[bucket]!, piece, crispRect(r), 1, zoom);
  }
  if (any) {
    ctx.lineWidth = 1;
    depths.forEach((color, i) => {
      ctx.strokeStyle = rgba(color, c.wireAlpha);
      ctx.stroke(settledLines[i]!);
      ctx.fillStyle = rgba(color, c.wireAlpha * 0.62);
      ctx.fill(settledBars[i]!);
    });
  }
  // Outlines tracing now, and the ones just traced, glow brighter.
  const tips: [number, number][] = [];
  for (const { piece, r, p, glow, bucket } of fresh) {
    const color = mixColor(depths[bucket]!, c.core, 0.35 * glow);
    const energy = p < 1 ? 1 : glow;
    ctx.beginPath();
    if (piece.shape === "text") {
      textBars(ctx, r, piece.lines, p);
      ctx.fillStyle = rgba(color, c.wireAlpha * 0.62 + (1 - c.wireAlpha * 0.62) * energy);
      ctx.fill();
      continue;
    }
    tips.push(...wirePath(ctx, piece, crispRect(r), p, zoom));
    ctx.strokeStyle = rgba(color, 0.28 * energy);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = rgba(color, c.wireAlpha + (1 - c.wireAlpha) * energy);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  drawTips(ctx, tips, c, 1.2);
}

export type { HoloShape };
