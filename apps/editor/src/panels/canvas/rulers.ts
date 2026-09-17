/**
 * Canvas ruler math: tick spacing that stays readable at any zoom, tick positions along a ruler, and
 * the selection's extent on each ruler. Positions are CSS pixels inside the canvas body; values are
 * artboard points.
 */

import type { Rect } from "./geometry.ts";
import type { Viewport } from "./viewport.ts";

/** Thickness of the rulers in CSS pixels. */
export const RULER_SIZE = 20;

export interface RulerScale {
  /** Points between labeled ticks. */
  major: number;
  /** Points between small ticks (equal to `major` when there's no room for them). */
  minor: number;
}

const MANTISSAS = [1, 2, 5] as const;

/**
 * Tick spacing for a zoom: the smallest 1-2-5 step whose labeled ticks sit at least `minMajorPx`
 * apart, subdivided when the small ticks would sit at least `minMinorPx` apart. Never below 1 point.
 */
export function rulerScale(zoom: number, minMajorPx = 56, minMinorPx = 6): RulerScale {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  let exponent = Math.max(0, Math.floor(Math.log10(minMajorPx / z)) - 1);
  let major = 1;
  for (let guard = 0; guard < 40; guard++) {
    const found = MANTISSAS.map((m) => m * 10 ** exponent).find((step) => step * z >= minMajorPx);
    if (found !== undefined) {
      major = found;
      break;
    }
    exponent++;
  }
  const leading = Math.round(major / 10 ** Math.floor(Math.log10(major)));
  const divisions = leading === 2 ? [4, 2] : [5, 2];
  const division = divisions.find((d) => (major / d) * z >= minMinorPx && Number.isInteger(major / d)) ?? 1;
  return { major, minor: major / division };
}

export interface RulerTick {
  /** CSS pixels from the ruler's start. */
  position: number;
  /** Artboard points. */
  value: number;
  major: boolean;
}

/**
 * Ticks on a ruler `length` pixels long, where artboard value v sits at `offset + v × zoom`.
 * Includes one tick before and after the visible range so labels don't pop at the edges.
 */
export function rulerTicks(offset: number, zoom: number, length: number, scale: RulerScale = rulerScale(zoom)): RulerTick[] {
  if (!(zoom > 0) || !(length > 0) || !(scale.minor > 0)) return [];
  const ratio = Math.max(1, Math.round(scale.major / scale.minor));
  const first = Math.floor(-offset / zoom / scale.minor) - 1;
  const last = Math.ceil((length - offset) / zoom / scale.minor) + 1;
  const out: RulerTick[] = [];
  for (let i = first; i <= last && out.length < 4000; i++) {
    const value = i * scale.minor;
    out.push({ position: offset + value * zoom, value: Object.is(value, -0) ? 0 : value, major: i % ratio === 0 });
  }
  return out;
}

/** Ruler label text: whole points without decimals. */
export function formatRulerValue(value: number): string {
  const r = Math.round(value * 100) / 100;
  return r === 0 ? "0" : String(r);
}

export interface RulerRange {
  /** CSS pixels from the ruler's start. */
  start: number;
  end: number;
  /** Artboard points at the start and end. */
  from: number;
  to: number;
}

/** The selection's extent on the horizontal ("x") or vertical ("y") ruler. */
export function rulerRange(bounds: Rect | null, viewport: Viewport, axis: "x" | "y"): RulerRange | null {
  if (!bounds) return null;
  const from = axis === "x" ? bounds.x : bounds.y;
  const size = axis === "x" ? bounds.width : bounds.height;
  const offset = axis === "x" ? viewport.x : viewport.y;
  return { start: offset + from * viewport.zoom, end: offset + (from + size) * viewport.zoom, from, to: from + size };
}
