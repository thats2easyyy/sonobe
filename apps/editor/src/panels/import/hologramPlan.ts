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

/** Corner radii in points, clockwise from the top left (the order canvas roundRect takes). */
export type Radii = readonly [number, number, number, number];

export interface HoloLayer {
  id: Id;
  shape: HoloShape;
  /** Artboard rect, clipped to the screen and to the layers that clip it. */
  rect: Rect;
  /** 1 for the screen's children. */
  depth: number;
  /** The nearest ancestor that has a wireframe too (null: the screen). */
  parent: Id | null;
  /** Corner radii (boxes and images), rounder where a clipping ancestor's rounded corner cuts them. */
  radii: Radii;
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
  /** The closing bloom around the frame: it swells, then breathes out. */
  glowMs: 400,
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

export const SQUARE: Radii = [0, 0, 0, 0];

/** A layer's corner radii as the renderer reads them: cornerRadii when it rounds any corner, else cornerRadius. */
export function radiiOf(props: Readonly<Record<string, unknown>>): Radii {
  const raw = props.cornerRadii;
  if (Array.isArray(raw) && raw.length > 0) {
    const radii = [0, 1, 2, 3].map((i) => Math.max(0, num(raw[i], 0))) as [number, number, number, number];
    if (radii.some((r) => r > 0)) return radii;
  }
  const r = Math.max(0, num(props.cornerRadius, 0));
  return [r, r, r, r];
}

/** What clips a layer: its nearest clipping ancestor's visible rect and corners. */
export interface HoloClip {
  rect: Rect;
  radii: Radii;
}

/**
 * The corners `rect` shows inside a clipping ancestor. A corner that pokes out of the ancestor's rounded
 * corner is rounded concentrically with it (an avatar image clipped to a circle draws as a circle, a
 * header across a card's top gets the card's top corners), and no corner is rounder than the rect allows.
 */
export function clippedRadii(rect: Rect, own: Radii, clip: HoloClip | null): Radii {
  const max = Math.min(rect.width, rect.height) / 2;
  const out = own.map((r) => Math.min(r, max)) as [number, number, number, number];
  if (!clip) return out;
  const left = rect.x - clip.rect.x;
  const top = rect.y - clip.rect.y;
  const right = clip.rect.x + clip.rect.width - (rect.x + rect.width);
  const bottom = clip.rect.y + clip.rect.height - (rect.y + rect.height);
  const insets: [number, number][] = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
  insets.forEach(([ix, iy], i) => {
    const R = clip.radii[i]!;
    // Only a corner point outside the ancestor's corner arc is cut.
    if (R <= 0 || ix >= R || iy >= R || (R - ix) ** 2 + (R - iy) ** 2 <= R * R) return;
    out[i] = Math.min(max, Math.max(out[i]!, R - Math.max(0, Math.min(ix, iy))));
  });
  return out;
}

/** Text line bars for a text box: its height over the line height, 1 to 3. */
export function textLines(height: number, fontSize: number, lineHeight: number): number {
  const line = lineHeight > 0 ? lineHeight : Math.max(1, fontSize) * 1.25;
  return clamp(Math.round(height / line), 1, 3);
}

/** Layers within this fraction of each other's area rank as equals: a CSS grid's 18.94 and 18.95 pt cells. */
export const AREA_TOLERANCE = 0.04;

/** `k` of `n` indices at a regular interval, centered: 3 of 9 are 1, 4 and 7. */
export function evenPicks(n: number, k: number): number[] {
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  if (k <= 0) return [];
  return Array.from({ length: k }, (_, j) => Math.floor(((j + 0.5) * n) / k));
}

/**
 * At most `budget` of a group of near-equal layers (in document order), thinned deliberately so they
 * read as a lighter sampling of the same layout: whole rows at a regular interval (a grid of cards
 * keeps every column), or every so many in document order for layers that don't stack in rows.
 */
export function sampleEvenly<T extends { rect: Rect }>(members: readonly T[], budget: number): T[] {
  if (members.length <= budget) return [...members];
  if (budget <= 0) return [];
  // A row: layers whose tops are within half a layer's height of the row's first.
  const tolerance = Math.max(0.5, Math.min(...members.map((m) => m.rect.height)) / 2);
  const rows: T[][] = [];
  for (const member of [...members].sort((a, b) => a.rect.y - b.rect.y)) {
    const row = rows[rows.length - 1];
    if (row && member.rect.y - row[0]!.rect.y <= tolerance) row.push(member);
    else rows.push([member]);
  }
  if (rows.length > 1) {
    const order = new Map(members.map((m, i) => [m, i]));
    for (let count = Math.floor((budget * rows.length) / members.length); count >= 1; count--) {
      const picked = evenPicks(rows.length, count).flatMap((i) => rows[i]!);
      if (picked.length <= budget) return picked.sort((a, b) => order.get(a)! - order.get(b)!);
    }
  }
  return evenPicks(members.length, budget).map((i) => members[i]!);
}

/**
 * A group that only holds text runs (@sonobe/import splits a paragraph that mixes styles into a text
 * layer per styled run) and draws nothing itself: its runs' line bars say enough, and a box around
 * them would read as a text field.
 */
export function isTextRunGroup(type: string, props: Readonly<Record<string, unknown>>, childTypes: readonly string[]): boolean {
  if (type !== "group" || childTypes.length === 0 || childTypes.some((t) => t !== "text")) return false;
  const color = props.color;
  // Scene props hold colors as { r, g, b, a }; documents as "#RRGGBBAA".
  const alpha = typeof color === "string" ? (/^#[0-9a-f]{8}$/i.test(color) ? parseInt(color.slice(7, 9), 16) / 255 : 1) : color && typeof color === "object" ? num((color as { a?: unknown }).a, 1) : 0;
  return alpha <= 0.01 && num(props.strokeWidth, 0) <= 0 && num(props.shadowOpacity, 0) <= 0 && num(props.backgroundBlur, 0) <= 0;
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

  const visit = (parentId: Id, parent: Id | null, depth: number, clip: HoloClip): void => {
    for (const child of index.children(parentId)) {
      const props = child.node?.props ?? {};
      // A hidden or transparent layer draws nothing, and neither does anything inside it.
      if (child.hidden || num(props.opacity, 1) <= 0.01) continue;
      const bounds = index.bounds(child.id);
      const visible = bounds ? intersectRects(bounds, clip.rect) : null;
      const shape = isTextRunGroup(child.layer.type, props, (child.layer.children ?? []).map((c) => c.type)) ? null : holoShapeOf(child.layer.type);
      const radii = visible ? clippedRadii(visible, radiiOf(props), clip) : SQUARE;
      let next = parent;
      if (visible && shape && visible.width >= minSize && visible.height >= minSize) {
        all.push({ id: child.id, shape, rect: visible, depth, parent, radii: shape === "box" || shape === "image" ? radii : SQUARE, lines: shape === "text" ? textLines(visible.height, num(props.fontSize, 17), num(props.lineHeight, 0)) : 0 });
        parentOf.set(child.id, parent);
        next = child.id;
      }
      // Children of a layer that doesn't clip can reach outside it.
      if (!child.layer.children?.length) continue;
      if (!child.node?.clip) visit(child.id, next, depth + 1, clip);
      else if (visible) visit(child.id, next, depth + 1, { rect: visible, radii });
    }
  };
  const screenNode = entry?.node;
  visit(screenId, null, 1, { rect: screen, radii: screenNode?.clip ? clippedRadii(screen, radiiOf(screenNode.props ?? {}), null) : SQUARE });

  if (all.length <= maxPieces) return { screen, layers: all };
  // The largest layers carry the layout. Near-equal ones (a grid of cards) rank together rather than
  // by hair-thin differences in size, which would drop whole columns, and the group the cap cuts
  // through is thinned evenly (sampleEvenly) rather than in document order, which would drop the
  // bottom rows.
  const bySize = all.map((layer, i) => ({ i, area: layer.rect.width * layer.rect.height })).sort((a, b) => b.area - a.area || a.i - b.i);
  const groups: number[][] = [];
  let groupArea = Infinity;
  for (const { i, area } of bySize) {
    if (groups.length === 0 || area < groupArea * (1 - AREA_TOLERANCE)) {
      groups.push([]);
      groupArea = area;
    }
    groups[groups.length - 1]!.push(i);
  }
  const kept = new Set<Id>();
  for (const group of groups) {
    const budget = maxPieces - kept.size;
    if (budget <= 0) break;
    const members = group.sort((a, b) => a - b).map((i) => all[i]!);
    for (const layer of sampleEvenly(members, budget)) kept.add(layer.id);
  }
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
  /** The closing bloom (0–1). */
  glow: number;
  /** The bloom's hairline (0–1): it flashes out as the bloom swells, and is gone when the selection outline comes back. */
  hairline: number;
  /** Everything's opacity. */
  alpha: number;
}

/** Where the closing bloom peaks, as a fraction of the glow phase. */
export const GLOW_PEAK = 0.3;

/**
 * Until when (ms from the start) the canvas holds the screen's selection outline, handles and size
 * badge back: they'd sit on the hologram's frame, so they return once the closing bloom has peaked.
 * Reduced motion's crossfade has no frame, so it holds nothing.
 */
export function chromeHeldUntil(plan: Pick<HoloPlan, "timeline" | "reduced">): number {
  const { upEnd, end } = plan.timeline;
  return plan.reduced ? 0 : upEnd + (end - upEnd) * GLOW_PEAK;
}

/** What the hologram shows `t` ms after it starts. */
export function holoFrameAt(plan: Pick<HoloPlan, "timeline" | "reduced">, t: number): HoloFrame {
  const { downStart, downEnd, upStart, upEnd, end } = plan.timeline;
  const off = { glow: 0, hairline: 0 };
  if (t >= end) return { phase: "done", laser: null, direction: 1, veil: 0, frame: 1, ...off, alpha: 0 };
  if (plan.reduced) {
    // Ease out of the veil quickly, so the fade doesn't linger half dark over the design.
    const alpha = (1 - clamp01(t / end)) ** 2;
    return { phase: "fade", laser: null, direction: 1, veil: 1, frame: 1, ...off, alpha };
  }
  if (t < downStart) return { phase: "power", laser: null, direction: 1, veil: 1, frame: clamp01(t / downStart), ...off, alpha: 1 };
  if (t < downEnd) return { phase: "down", laser: sweepCurve((t - downStart) / (downEnd - downStart)), direction: 1, veil: 1, frame: 1, ...off, alpha: 1 };
  if (t < upStart) return { phase: "hold", laser: 1, direction: 1, veil: 1, frame: 1, ...off, alpha: 1 };
  if (t < upEnd) {
    const y = 1 - sweepCurve((t - upStart) / (upEnd - upStart));
    return { phase: "up", laser: y, direction: -1, veil: y, frame: 1, ...off, alpha: 1 };
  }
  const u = clamp01((t - upEnd) / (end - upEnd));
  // The bloom swells quickly, then breathes out slowly. Its hairline flashes out as it swells and is
  // gone by the peak, when the selection outline comes back inside it (chromeHeldUntil).
  const glow = u < GLOW_PEAK ? 1 - (1 - u / GLOW_PEAK) ** 2 : (1 + Math.cos((Math.PI * (u - GLOW_PEAK)) / (1 - GLOW_PEAK))) / 2;
  const hairline = u < GLOW_PEAK ? Math.sin((Math.PI * u) / GLOW_PEAK) : 0;
  return { phase: "glow", laser: null, direction: -1, veil: 0, frame: 1, glow, hairline, alpha: 1 };
}

/** How far a piece's outline has traced (0–1) at `t`. */
export function traceProgress(piece: Pick<HoloPiece, "at">, t: number, reduced = false): number {
  if (reduced) return 1;
  return clamp01((t - piece.at) / HOLO.traceMs);
}
