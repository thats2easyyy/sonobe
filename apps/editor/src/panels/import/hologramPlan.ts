/**
 * The import hologram's schedule, as pure data: which layers of a new screen get a wireframe, and
 * when. A laser sweeps down the screen and each layer's outline starts tracing as the laser passes its
 * top edge, children after their parents and siblings one after another ("div by div"). Then the laser
 * sweeps back up and the real design materializes beneath it. Times are milliseconds from the start.
 */

import type { Id } from "@sonobe/core";
import type { Rect } from "../canvas/geometry.ts";
import type { CanvasIndex } from "../canvas/sceneIndex.ts";

/** How a layer's wireframe is drawn: an outline, an ellipse, 1–3 text line bars, or a box with an X. */
export type HoloShape = "box" | "oval" | "text" | "image";

export interface HoloLayer {
  id: Id;
  shape: HoloShape;
  /** Artboard rect, clipped to the screen and to the layers that clip it. */
  rect: Rect;
  /** 1 for the screen's children. */
  depth: number;
  /** The nearest ancestor that has a wireframe too (null: the screen). */
  parent: Id | null;
  /** Corner radius in points (boxes). */
  radius: number;
  /** Line bars (text). */
  lines: number;
}

export interface HoloPiece extends HoloLayer {
  /** When the outline starts tracing. */
  at: number;
}

export interface HoloTimeline {
  /** The frame traces around the screen before the laser starts. */
  downStart: number;
  downEnd: number;
  upStart: number;
  upEnd: number;
  /** After the frame's glow fades. */
  end: number;
}

export interface HoloPlan {
  screen: Rect;
  pieces: HoloPiece[];
  timeline: HoloTimeline;
  /** Reduced motion: no rain or sweeps, only a crossfade from the wireframe to the design. */
  reduced: boolean;
}

export const HOLO = {
  /** The frame tracing around the screen. */
  powerMs: 200,
  /** Down and up sweeps for a phone-height screen (874 pt). */
  downMs: 1600,
  upMs: 1300,
  /** Sweeps scale with the square root of the screen's height, within these factors. */
  minScale: 0.85,
  maxScale: 1.45,
  referenceHeight: 874,
  /** How long an outline takes to trace. */
  traceMs: 180,
  /** A child starts at least this long after its parent. */
  childDelayMs: 40,
  /** A sibling in the same row starts at least this long after the one before it. */
  siblingDelayMs: 14,
  /** Siblings the laser reaches within this long of each other are a row. */
  rowMs: 40,
  /** Outlines held back by those delays start no later than this after the down sweep. */
  tailMs: 120,
  /** The whole wireframe holds still between the sweeps. */
  holdMs: 150,
  /** The frame's closing glow and fade. */
  glowMs: 250,
  /** Reduced motion's crossfade. */
  fadeMs: 300,
  /** Early endings (a click, a key, an undo) fade this fast. */
  endFadeMs: 150,
  maxPieces: 600,
  /** Layers narrower or shorter than this (points) get no wireframe. */
  minSize: 2,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

/** The laser's position (0 top → 1 bottom) over a sweep's progress: mostly steady, easing at the ends. */
export function sweepCurve(u: number): number {
  const x = clamp01(u);
  return 0.6 * x + 0.4 * ((1 - Math.cos(Math.PI * x)) / 2);
}

/** The sweep progress at which the laser reaches `y` (inverse of sweepCurve). */
export function sweepProgressAt(y: number): number {
  const target = clamp01(y);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (sweepCurve(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** The wireframe a layer type draws as; null for layers that draw nothing of their own. */
export function holoShapeOf(type: string): HoloShape | null {
  switch (type) {
    case "colorFill":
    case "hitArea":
      return null;
    case "text":
      return "text";
    case "oval":
      return "oval";
    case "image":
    case "video":
    case "lottie":
      return "image";
    default:
      return "box";
  }
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** A stable pseudo-random order for index `i` (the same every time: plans replay alike). */
function scatter(i: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

/** Text line bars for a text box: its height over the line height, 1 to 3. */
export function textLines(height: number, fontSize: number, lineHeight: number): number {
  const line = lineHeight > 0 ? lineHeight : Math.max(1, fontSize) * 1.25;
  return clamp(Math.round(height / line), 1, 3);
}

/**
 * The wireframed layers inside a screen, in document order (parents before children): visible layers
 * at least `minSize` points across, clipped to the screen and to clipping ancestors, capped at the
 * `maxPieces` largest. Null when the screen isn't drawn.
 */
export function collectHoloLayers(index: CanvasIndex, screenId: Id, options: { maxPieces?: number; minSize?: number } = {}): { screen: Rect; layers: HoloLayer[] } | null {
  const maxPieces = options.maxPieces ?? HOLO.maxPieces;
  const minSize = options.minSize ?? HOLO.minSize;
  const entry = index.entry(screenId);
  const screen = entry && !entry.hidden ? index.bounds(screenId) : null;
  if (!screen || screen.width < 1 || screen.height < 1) return null;
  const all: HoloLayer[] = [];
  const parentOf = new Map<Id, Id | null>();

  const visit = (parentId: Id, parent: Id | null, depth: number, clip: Rect): void => {
    for (const child of index.children(parentId)) {
      if (child.hidden) continue;
      const bounds = index.bounds(child.id);
      const visible = bounds ? intersectRects(bounds, clip) : null;
      const shape = holoShapeOf(child.layer.type);
      const props = child.node?.props ?? {};
      let next = parent;
      if (visible && shape && visible.width >= minSize && visible.height >= minSize && num(props.opacity, 1) > 0.01) {
        const radius = shape === "box" || shape === "image" ? clamp(num(props.cornerRadius, 0), 0, Math.min(visible.width, visible.height) / 2) : 0;
        all.push({ id: child.id, shape, rect: visible, depth, parent, radius, lines: shape === "text" ? textLines(visible.height, num(props.fontSize, 17), num(props.lineHeight, 0)) : 0 });
        parentOf.set(child.id, parent);
        next = child.id;
      }
      // Children of a layer that doesn't clip can reach outside it.
      if (!child.layer.children?.length) continue;
      if (!child.node?.clip) visit(child.id, next, depth + 1, clip);
      else if (visible) visit(child.id, next, depth + 1, visible);
    }
  };
  visit(screenId, null, 1, screen);

  if (all.length <= maxPieces) return { screen, layers: all };
  // The largest layers carry the layout. Equal ones (a grid of cards) are sampled across the screen
  // in a fixed scatter rather than by document order, which would leave the bottom rows empty.
  const ranked = all.map((layer, i) => ({ i, area: layer.rect.width * layer.rect.height, tie: scatter(i) })).sort((a, b) => b.area - a.area || a.tie - b.tie);
  const kept = new Set(ranked.slice(0, maxPieces).map((r) => all[r.i]!.id));
  const keptAncestor = (id: Id | null): Id | null => {
    let at = id;
    while (at !== null && !kept.has(at)) at = parentOf.get(at) ?? null;
    return at;
  };
  return { screen, layers: all.filter((l) => kept.has(l.id)).map((l) => ({ ...l, parent: keptAncestor(l.parent) })) };
}

/** How much longer the sweeps run for a screen of this height (points). */
export function sweepScale(height: number): number {
  return clamp(Math.sqrt(Math.max(1, height) / HOLO.referenceHeight), HOLO.minScale, HOLO.maxScale);
}

/** When each wireframe traces, and when the sweeps run. */
export function planHologram(screen: Rect, layers: readonly HoloLayer[], options: { reduced?: boolean } = {}): HoloPlan {
  if (options.reduced) {
    return { screen, reduced: true, pieces: layers.map((l) => ({ ...l, at: 0 })), timeline: { downStart: 0, downEnd: 0, upStart: 0, upEnd: 0, end: HOLO.fadeMs } };
  }
  const scale = sweepScale(screen.height);
  const down = HOLO.downMs * scale;
  const up = HOLO.upMs * scale;
  const downStart = HOLO.powerMs;
  const downEnd = downStart + down;
  const latest = downEnd + HOLO.tailMs;
  const startOf = new Map<Id, number>();
  /** The previous sibling, per parent: when the laser reached it, when it started, and its place in its row. */
  const lastChild = new Map<Id | null, { reach: number; at: number; inRow: number }>();
  const pieces = layers.map((layer): HoloPiece => {
    const reach = downStart + down * sweepProgressAt((layer.rect.y - screen.y) / screen.height);
    const parentAt = layer.parent !== null ? startOf.get(layer.parent) : undefined;
    const sibling = lastChild.get(layer.parent);
    let at = reach;
    if (parentAt !== undefined) at = Math.max(at, parentAt + HOLO.childDelayMs);
    // Siblings in a row (the laser reaches them together) follow one another, closer together along a
    // long row so it keeps up with the laser; one higher up doesn't wait.
    const inRow = sibling && Math.abs(reach - sibling.reach) <= HOLO.rowMs ? sibling.inRow + 1 : 0;
    if (sibling && inRow > 0) at = Math.max(at, sibling.at + HOLO.siblingDelayMs / (1 + inRow / 8));
    // Held back past the sweep: start with the stragglers, but never before the parent.
    at = Math.round(Math.max(Math.min(at, latest), parentAt ?? 0));
    startOf.set(layer.id, at);
    lastChild.set(layer.parent, { reach, at, inRow });
    return { ...layer, at };
  });
  const traced = pieces.reduce((m, p) => Math.max(m, p.at + HOLO.traceMs), downEnd);
  const upStart = Math.round(traced + HOLO.holdMs);
  const upEnd = Math.round(upStart + up);
  return { screen, reduced: false, pieces, timeline: { downStart, downEnd: Math.round(downEnd), upStart, upEnd, end: upEnd + HOLO.glowMs } };
}

export type HoloPhase = "power" | "down" | "hold" | "up" | "glow" | "fade" | "done";

export interface HoloFrame {
  phase: HoloPhase;
  /** The laser's height in the screen (0 top → 1 bottom), or null when it's off. */
  laser: number | null;
  /** 1 sweeping down, -1 sweeping up. */
  direction: 1 | -1;
  /** The veil covers the screen from the top down to here (0–1). */
  veil: number;
  /** How far the frame has traced around the screen (0–1). */
  frame: number;
  /** The closing glow (0–1). */
  glow: number;
  /** Everything's opacity. */
  alpha: number;
}

/** What the hologram shows `t` ms after it starts. */
export function holoFrameAt(plan: HoloPlan, t: number): HoloFrame {
  const { downStart, downEnd, upStart, upEnd, end } = plan.timeline;
  if (t >= end) return { phase: "done", laser: null, direction: 1, veil: 0, frame: 1, glow: 0, alpha: 0 };
  if (plan.reduced) {
    // Ease out of the veil quickly, so the fade doesn't linger half dark over the design.
    const alpha = (1 - clamp01(t / end)) ** 2;
    return { phase: "fade", laser: null, direction: 1, veil: 1, frame: 1, glow: 0, alpha };
  }
  if (t < downStart) return { phase: "power", laser: null, direction: 1, veil: 1, frame: clamp01(t / downStart), glow: 0, alpha: 1 };
  if (t < downEnd) return { phase: "down", laser: sweepCurve((t - downStart) / (downEnd - downStart)), direction: 1, veil: 1, frame: 1, glow: 0, alpha: 1 };
  if (t < upStart) return { phase: "hold", laser: 1, direction: 1, veil: 1, frame: 1, glow: 0, alpha: 1 };
  if (t < upEnd) {
    const y = 1 - sweepCurve((t - upStart) / (upEnd - upStart));
    return { phase: "up", laser: y, direction: -1, veil: y, frame: 1, glow: 0, alpha: 1 };
  }
  const u = clamp01((t - upEnd) / (end - upEnd));
  // A quick flare, then the frame fades out.
  return { phase: "glow", laser: null, direction: -1, veil: 0, frame: 1, glow: u < 0.3 ? u / 0.3 : 1 - (u - 0.3) / 0.7, alpha: 1 - u * u };
}

/** How far a piece's outline has traced (0–1) at `t`. */
export function traceProgress(piece: Pick<HoloPiece, "at">, t: number, reduced = false): number {
  if (reduced) return 1;
  return clamp01((t - piece.at) / HOLO.traceMs);
}
