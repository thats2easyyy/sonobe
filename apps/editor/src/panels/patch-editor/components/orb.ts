/**
 * The orb a cable sends from its output into its input when a pulse fires or a boolean flips: how
 * long it takes and its keyframes, which orbFlight.ts plays with the Web Animations API. The browser
 * runs them, so nothing re-renders while an orb is in flight. When an orb may leave is orbSchedule.ts.
 */

import { cableControlOffset, cablePoint } from "../model/geometry.ts";

/** "full" for a pulse or a boolean turning on; "dim" (smaller, fainter) for a boolean turning off. */
export type OrbTone = "full" | "dim";

/** Orbs one cable can have in flight at once; their elements are reused in turn. */
export const ORB_SLOTS = 3;
/** Radius of the orb's gradient (flow units): a hot core, the cable's color, then a fading halo. */
export const ORB_RADIUS = 16;
/**
 * A cable ends on the outer edge of its ports' 16-unit handles (.sb-pe-handle in patch-editor.css),
 * this far from the centre of each port's dot. The orb leaves from inside the output's dot and
 * flies on into the input's.
 */
export const ORB_INSET = 8;
/** The flare and ring that spread from the input's dot when an orb lands. */
export const LANDING_MS = 440;

/** Flight time for a cable of this length, so short and long cables feel alike. */
export function orbDuration(length: number): number {
  return Math.round(Math.min(900, Math.max(300, 220 + length * 0.55)));
}

/**
 * Shortest wait between two orbs on one cable, so a pulse that fires every frame sends a steady
 * stream: never more than two in flight, and no slot reused before its landing (over `done` ms into
 * its flight) has faded.
 */
export function orbGap(duration: number, done: number): number {
  return Math.max(duration / 2, done / ORB_SLOTS);
}

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of time in [0, 1]. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a: number, b: number, u: number) => 3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < t) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

/**
 * Leaves the output quickly and is still moving when it reaches the input, so it sinks into the port
 * rather than hovering beside it: the last tenth of the cable takes about a third of the flight.
 */
export const orbEase = cubicBezier(0.2, 0.55, 0.45, 0.9);

/** The time at which an increasing easing reaches `progress`. */
export function invertEase(ease: (t: number) => number, progress: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (ease(mid) < progress) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** A cable curve measured by arc length. */
export interface CableArc {
  length: number;
  pointAt(distance: number): [number, number];
  /** The unit normal there: the direction of travel turned a quarter turn clockwise on screen. */
  normalAt(distance: number): [number, number];
  /** The point and the normal in one lookup: [x, y, nx, ny]. */
  frameAt(distance: number): [number, number, number, number];
}

/**
 * Measure the cable from (sx, sy) to (tx, ty) (the curve cablePath draws), carried on `inset` units
 * straight past each end. The curve leaves and enters horizontally, so the extensions are seamless.
 */
export function cableArc(sx: number, sy: number, tx: number, ty: number, inset = 0, segments = 64): CableArc {
  const c = cableControlOffset(sx, tx);
  const count = segments + 1 + (inset > 0 ? 2 : 0);
  // Per point: its position, its unit tangent, and how far along the arc it is.
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const dxs = new Float64Array(count);
  const dys = new Float64Array(count);
  const lengths = new Float64Array(count);
  let n = 0;
  const push = (x: number, y: number, dx: number, dy: number) => {
    const norm = Math.hypot(dx, dy);
    xs[n] = x;
    ys[n] = y;
    dxs[n] = norm > 1e-9 ? dx / norm : 1;
    dys[n] = norm > 1e-9 ? dy / norm : 0;
    if (n > 0) lengths[n] = lengths[n - 1]! + Math.hypot(x - xs[n - 1]!, y - ys[n - 1]!);
    n++;
  };
  if (inset > 0) push(sx - inset, sy, 1, 0);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    const [x, y] = cablePoint(t, sx, sy, tx, ty);
    // The cubic's derivative, with controls (sx + c, sy) and (tx - c, ty).
    push(x, y, 3 * u * u * c + 6 * u * t * (tx - sx - 2 * c) + 3 * t * t * c, 6 * u * t * (ty - sy));
  }
  if (inset > 0) push(tx + inset, ty, 1, 0);
  const last = count - 1;
  const length = lengths[last]!;
  const frameAt = (distance: number): [number, number, number, number] => {
    let lo = 0;
    let k = 0;
    if (distance >= length) {
      lo = last - 1;
      k = 1;
    } else if (distance > 0) {
      let hi = last;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (lengths[mid]! <= distance) lo = mid;
        else hi = mid;
      }
      k = (distance - lengths[lo]!) / (lengths[lo + 1]! - lengths[lo]! || 1);
    }
    const hi = lo + 1;
    const dx = dxs[lo]! + (dxs[hi]! - dxs[lo]!) * k;
    const dy = dys[lo]! + (dys[hi]! - dys[lo]!) * k;
    const norm = Math.hypot(dx, dy) || 1;
    return [xs[lo]! + (xs[hi]! - xs[lo]!) * k, ys[lo]! + (ys[hi]! - ys[lo]!) * k, -dy / norm, dx / norm];
  };
  return {
    length,
    frameAt,
    pointAt(distance) {
      const [x, y] = frameAt(distance);
      return [x, y];
    },
    normalAt(distance) {
      const [, , nx, ny] = frameAt(distance);
      return [nx, ny];
    },
  };
}

/** A piecewise-linear profile over the flight: [time, value] pairs with increasing times. */
type Profile = readonly (readonly [number, number])[];

export function profileAt(profile: Profile, t: number): number {
  if (t <= profile[0]![0]) return profile[0]![1];
  for (let i = 1; i < profile.length; i++) {
    const [t1, v1] = profile[i]!;
    const [t0, v0] = profile[i - 1]!;
    if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0 || 1);
  }
  return profile[profile.length - 1]![1];
}

/**
 * A tapered, filled stretch of wire behind the head: at most `max` long, and never further back
 * than where the head was `lag` ago, so it shrinks away as the orb slows. It's `width` wide at the
 * head, with a round nose over it, and narrows to a point at its far end (half-width ∝ u^taper).
 */
interface Trail {
  max: number;
  lag: number;
  width: number;
  taper: number;
  /** Points along each side. */
  points: number;
  /** Strength over the flight, given when the head reaches the input's dot. */
  opacity: (arrive: number) => Profile;
}

/**
 * Drawn back to front, each shorter than the one behind it, and each tapering to a point, so
 * together they fade toward the far end.
 */
const TRAILS = {
  /** The wire the orb has just passed, brightened for a moment. */
  wake: { max: 190, lag: 0.34, width: 4.2, taper: 1.3, points: 8, opacity: (a) => [[0, 0], [0.1, 1], [a - 0.2, 0.7], [a + 0.04, 0]] },
  /** The comet's tail, in the cable's color. */
  tail: { max: 64, lag: 0.14, width: 6.4, taper: 0.9, points: 7, opacity: (a) => [[0, 0], [0.05, 1], [a - 0.1, 0.95], [a + 0.04, 0]] },
  /** The tail's hot center. */
  streak: { max: 30, lag: 0.07, width: 2.6, taper: 0.8, points: 5, opacity: (a) => [[0, 0], [0.04, 1], [a - 0.08, 1], [a, 0]] },
} satisfies Record<string, Trail>;

export type OrbTrail = keyof typeof TRAILS;
export const ORB_TRAILS = Object.keys(TRAILS) as OrbTrail[];

const TONE = { full: { opacity: 1, size: 1, trail: 1 }, dim: { opacity: 0.6, size: 0.62, trail: 0.6 } } as const;

/**
 * Keyframe times: every 1/12 of the flight, plus one every ~24 units along the cable, at most 16,
 * so they're dense where the orb is fast. The browser draws straight lines between them, so this is
 * also how closely the head follows the curve.
 */
export function orbSampleTimes(length: number, ease: (t: number) => number = orbEase): number[] {
  const times: number[] = [];
  for (let i = 0; i <= 12; i++) times.push(i / 12);
  const steps = Math.min(16, Math.ceil(length / 24));
  for (let i = 1; i < steps; i++) times.push(invertEase(ease, i / steps));
  times.sort((a, b) => a - b);
  return times.filter((t, i) => i === 0 || t - times[i - 1]! > 0.012);
}

/** When in the flight (0 to 1) the head comes within ORB_INSET of the end: it's reached the input's dot. */
export function arrivalTime(length: number, ease: (t: number) => number = orbEase): number {
  return Math.min(0.95, Math.max(0.8, invertEase(ease, 1 - ORB_INSET / Math.max(length, 2 * ORB_INSET))));
}

export interface OrbPlan {
  duration: number;
  length: number;
  head: Keyframe[];
  /** Worked out the first time they're asked for, since the head can leave without them (orbFlight.ts). */
  trails(): Record<OrbTrail, Keyframe[]>;
  /** A flare and a spreading ring on the input's dot, LANDING_MS long, starting `landing` ms into the flight. */
  flare: Keyframe[];
  ring: Keyframe[];
  landing: number;
}

const round = (n: number) => Math.round(n * 100) / 100;
const px = (n: number) => `${round(n)}px`;

/**
 * The trail between two distances along `arc`, as a closed CSS path(): `points` points up one side
 * and back down the other, around a round nose past `to`. Every keyframe has the same number of
 * points, so the browser interpolates between them.
 */
export function ribbon(arc: CableArc, from: number, to: number, points: number, width: number, taper: number): string {
  const half = width / 2;
  const stations: [distance: number, half: number][] = [];
  for (let i = 0; i < points; i++) {
    const u = i / (points - 1);
    stations.push([from + (to - from) * u, half * u ** taper]);
  }
  stations.push([to + half * 0.55, half * 0.84], [to + half, 0]);
  const left: string[] = [];
  const right: string[] = [];
  for (const [distance, offset] of stations) {
    const [x, y, nx, ny] = arc.frameAt(distance);
    left.push(`${round(x + nx * offset)} ${round(y + ny * offset)}`);
    right.push(`${round(x - nx * offset)} ${round(y - ny * offset)}`);
  }
  return `path("M ${left.join(" L ")} L ${right.reverse().join(" L ")} Z")`;
}

/**
 * Keyframes for one orb along `arc` (measured with ORB_INSET, so it runs dot to dot): the head, the
 * trails behind it, and the landing on the input's dot. The head moves by `cx` and `cy` rather than
 * a transform: an animated transform on an SVG element costs Chromium far more with a few dozen in
 * flight, and can run on the compositor, where it pulls ahead of the trails. Parts fade by
 * fill-opacity and stroke-opacity for the same reason (see the .sb-pe-orb rules in patch-editor.css).
 */
export function orbPlan(arc: CableArc, tone: OrbTone): OrbPlan {
  const { length } = arc;
  const duration = orbDuration(length);
  const look = TONE[tone];
  const arrive = arrivalTime(length);
  // It swells out of the output, then shrinks and fades as it sinks into the input.
  const headSize: Profile = [
    [0, 0.45],
    [0.12, 1],
    [arrive - 0.12, 1],
    [1, 0.3],
  ];
  const headOpacity: Profile = [
    [0, 0],
    [0.05, 1],
    [arrive - 0.04, 1],
    [1, 0],
  ];
  const times = orbSampleTimes(length);
  const head = times.map((t): Keyframe => {
    const [x, y] = arc.pointAt(length * orbEase(t));
    return { offset: t, cx: px(x), cy: px(y), r: px(ORB_RADIUS * look.size * profileAt(headSize, t)), fillOpacity: round(look.opacity * profileAt(headOpacity, t)) };
  });
  let trails: Record<OrbTrail, Keyframe[]> | undefined;
  const size = look.size;
  const flare: Keyframe[] = [
    { offset: 0, fillOpacity: 0, r: px(4 * size) },
    { offset: 0.14, fillOpacity: look.opacity, r: px(8 * size) },
    { offset: 1, fillOpacity: 0, r: px(12 * size) },
  ];
  const ring: Keyframe[] = [
    { offset: 0, strokeOpacity: 0, r: px(4.5 * size), strokeWidth: 2 },
    { offset: 0.12, strokeOpacity: round(0.85 * look.opacity), r: px(6 * size) },
    { offset: 1, strokeOpacity: 0, r: px(17 * size), strokeWidth: 0.4 },
  ];
  return {
    duration,
    length,
    head,
    trails() {
      if (trails) return trails;
      trails = {} as Record<OrbTrail, Keyframe[]>;
      for (const name of ORB_TRAILS) {
        const trail: Trail = TRAILS[name];
        const fade = trail.opacity(arrive);
        trails[name] = times.map((t) => {
          const at = length * orbEase(t);
          const from = Math.max(0, at - trail.max * look.trail, t > trail.lag ? length * orbEase(t - trail.lag) : 0);
          return { offset: t, d: ribbon(arc, from, at, trail.points, trail.width * look.size, trail.taper), fillOpacity: round(look.opacity * profileAt(fade, t)) };
        });
      }
      return trails;
    },
    flare,
    ring,
    landing: Math.round(duration * (arrive - 0.03)),
  };
}
