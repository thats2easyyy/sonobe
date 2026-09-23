/**
 * The Design with Claude build, as data: the loader boxes that stand in for the page's elements while
 * Claude writes, when each one appears, and the final sweep that reveals the page. The preview page
 * reports its elements' boxes (previewShell.ts); each new one joins a queue, so a burst of html still
 * builds box by box. While the page is written the laser sweeps down and up; once it's complete and
 * every box is in place, the laser runs to the bottom and sweeps up one last time, and the page
 * shows beneath it. Times are performance.now() milliseconds; rects are in the page's points.
 */

import type { Rect } from "../canvas/geometry.ts";
import { HOLO, sweepCurve } from "../import/hologramPlan.ts";

export type BuildShape = "box" | "oval" | "text" | "image";

/** One element of the page, as the preview measured it. `key` is its path in the page, so it keeps its box as the page grows. */
export interface PageBox {
  key: string;
  shape: BuildShape;
  rect: Rect;
  /** Text line bars (1–3). */
  lines: number;
  radius: number;
}

export interface BuildBox extends PageBox {
  /** When it starts tracing in. */
  at: number;
}

export interface BuildState {
  boxes: Map<string, BuildBox>;
  /** When the last queued box starts. */
  lastAt: number;
}

export const BUILD = {
  /** How long a box takes to trace in. */
  traceMs: 260,
  /** A burst of new boxes spreads over about this long, */
  burstMs: 1600,
  /** one box at least this often, and at most this far apart. */
  minGapMs: 6,
  maxGapMs: 70,
  /** The final run to the bottom, for the whole height. */
  finalDownMs: 700,
  /** The closing glow around the frame after the reveal. */
  glowMs: 400,
  /** Reduced motion: the loader boxes crossfade to the page. */
  fadeMs: 300,
  maxBoxes: 600,
} as const;

/** The shapes' codes in the preview's messages. */
export const SHAPE_CODES: readonly BuildShape[] = ["box", "oval", "text", "image"];

export function createBuild(): BuildState {
  return { boxes: new Map(), lastAt: -Infinity };
}

/**
 * Take the page's latest boxes: a box already there keeps its start and moves to its new rect, a new
 * one is queued after the others, and one the page no longer has goes.
 */
export function addPageBoxes(state: BuildState, boxes: readonly PageBox[], now: number): void {
  const seen = new Set<string>();
  const fresh: PageBox[] = [];
  for (const box of boxes) {
    if (seen.has(box.key)) continue;
    seen.add(box.key);
    const had = state.boxes.get(box.key);
    if (had) state.boxes.set(box.key, { ...box, at: had.at });
    else fresh.push(box);
  }
  for (const key of [...state.boxes.keys()]) if (!seen.has(key)) state.boxes.delete(key);
  if (!fresh.length) return;
  const gap = Math.min(BUILD.maxGapMs, Math.max(BUILD.minGapMs, BUILD.burstMs / fresh.length));
  let at = Math.max(now, state.lastAt + gap);
  for (const box of fresh) {
    if (state.boxes.size >= BUILD.maxBoxes) break;
    state.boxes.set(box.key, { ...box, at });
    state.lastAt = at;
    at += gap;
  }
}

/** When every box has traced in. */
export function buildReadyAt(state: BuildState): number {
  return state.lastAt + BUILD.traceMs;
}

/** Validates the boxes a preview posted: `[key, shape, x, y, width, height, lines, radius]` each. */
export function readPageBoxes(value: unknown): PageBox[] | null {
  if (!Array.isArray(value)) return null;
  const boxes: PageBox[] = [];
  for (const entry of value.slice(0, BUILD.maxBoxes)) {
    if (!Array.isArray(entry) || entry.length !== 8 || typeof entry[0] !== "string" || entry[0].length > 400) return null;
    const [key, code, x, y, width, height, lines, radius] = entry as [string, ...unknown[]];
    const nums = [code, x, y, width, height, lines, radius];
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    const shape = SHAPE_CODES[code as number];
    if (!shape || (width as number) <= 0 || (height as number) <= 0) return null;
    boxes.push({ key, shape, rect: { x: x as number, y: y as number, width: width as number, height: height as number }, lines: Math.max(1, Math.min(3, Math.round(lines as number))), radius: Math.max(0, radius as number) });
  }
  return boxes;
}

/** The final sweep: from where the laser is, down to the bottom, then up one last time, revealing the page. */
export interface FinalSweep {
  start: number;
  fromY: number;
  downEnd: number;
  upEnd: number;
  end: number;
  reduced: boolean;
}

/** The up sweep scales with the page's height (points), like the import hologram's. */
export function upSweepMs(height: number): number {
  const scale = Math.min(HOLO.maxScale, Math.max(HOLO.minScale, Math.sqrt(Math.max(1, height) / HOLO.referenceHeight)));
  return HOLO.upMs * scale;
}

export function planFinalSweep(now: number, laserY: number, height: number, reduced: boolean): FinalSweep {
  if (reduced) return { start: now, fromY: 1, downEnd: now, upEnd: now + BUILD.fadeMs, end: now + BUILD.fadeMs, reduced };
  const fromY = Math.min(1, Math.max(0, laserY));
  const downEnd = now + (1 - fromY) * BUILD.finalDownMs;
  const upEnd = downEnd + upSweepMs(height);
  return { start: now, fromY, downEnd, upEnd, end: upEnd + BUILD.glowMs, reduced };
}

/**
 * The final sweep at `now`: the laser's position (0 top → 1 bottom) and direction, how much of the
 * page is still veiled (the page shows below `reveal`), and the closing glow (0–1).
 */
export function finalSweepAt(f: FinalSweep, now: number): { y: number; direction: 1 | -1; reveal: number; glow: number; laser: boolean } {
  if (f.reduced) return { y: 0, direction: -1, reveal: 1, glow: 0, laser: false };
  if (now < f.downEnd) {
    const u = (now - f.start) / Math.max(1, f.downEnd - f.start);
    return { y: f.fromY + (1 - f.fromY) * Math.min(1, u), direction: 1, reveal: 1, glow: 0, laser: true };
  }
  if (now < f.upEnd) {
    const y = 1 - sweepCurve((now - f.downEnd) / (f.upEnd - f.downEnd));
    return { y, direction: -1, reveal: y, glow: 0, laser: true };
  }
  const g = Math.min(1, (now - f.upEnd) / BUILD.glowMs);
  return { y: 0, direction: -1, reveal: 0, glow: Math.sin(Math.PI * g), laser: false };
}
