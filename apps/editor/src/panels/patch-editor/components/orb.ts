/**
 * The orb a cable sends from its output into its input when a pulse fires or a boolean flips: how
 * long it takes, how often a cable may send one, and its keyframes, which orbFlight.ts plays with the
 * Web Animations API. The browser runs them, so nothing re-renders while an orb is in flight.
 */

import { cablePoint } from "../model/geometry.ts";

/** "full" for a pulse or a boolean turning on; "dim" (smaller, fainter) for a boolean turning off. */
export type OrbTone = "full" | "dim";

/** Orbs one cable can have in flight at once; their elements are reused in turn. */
export const ORB_SLOTS = 3;
/** Radius of the orb's gradient (flow units): a hot core, the cable's color, then a fading halo. */
export const ORB_RADIUS = 16;
/** The bloom and ring that spread from the input when an orb lands. */
export const LANDING_MS = 420;
/** Where in the flight the landing starts, so it overlaps the orb settling in. */
const LANDING_AT = 0.84;

/** Flight time for a cable of this length, so short and long cables feel alike. */
export function orbDuration(length: number): number {
  return Math.round(Math.min(900, Math.max(300, 220 + length * 0.55)));
}

/**
 * Shortest wait between two orbs on one cable, so a pulse that fires every frame sends a steady
 * stream: never more than two in flight, and no slot reused before its landing has faded.
 */
export function orbGap(duration: number): number {
  return Math.max(duration / 2, (duration * LANDING_AT + LANDING_MS) / ORB_SLOTS);
}

/** Lets a send through when at least `gap` ms have passed since the last one it let through. */
export function createThrottle(): (now: number, gap: number) => boolean {
  let last = -Infinity;
  return (now, gap) => {
    if (now - last < gap) return false;
    last = now;
    return true;
  };
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

/** Leaves the output quickly, settles into the input. */
export const orbEase = cubicBezier(0.3, 0.7, 0.25, 1);

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
}

/** Measure the cable from (sx, sy) to (tx, ty) (the curve cablePath draws). */
export function cableArc(sx: number, sy: number, tx: number, ty: number, segments = 64): CableArc {
  const points: [number, number][] = [];
  const lengths: number[] = [0];
  for (let i = 0; i <= segments; i++) points.push(cablePoint(i / segments, sx, sy, tx, ty));
  for (let i = 1; i <= segments; i++) lengths.push(lengths[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
  const length = lengths[segments]!;
  return {
    length,
    pointAt(distance) {
      if (distance <= 0) return points[0]!;
      if (distance >= length) return points[segments]!;
      let lo = 0;
      let hi = segments;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (lengths[mid]! <= distance) lo = mid;
        else hi = mid;
      }
      const span = lengths[hi]! - lengths[lo]! || 1;
      const k = (distance - lengths[lo]!) / span;
      const a = points[lo]!;
      const b = points[hi]!;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
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

const HEAD_OPACITY: Profile = [
  [0, 0],
  [0.06, 1],
  [0.82, 1],
  [1, 0],
];
/** The head's radius as a share of ORB_RADIUS: it swells out of the output and shrinks into the input. */
const HEAD_SIZE: Profile = [
  [0, 0.4],
  [0.14, 1],
  [0.72, 1],
  [1, 0.35],
];

/** A stretch of wire behind the orb: at most `max` long, and never further back than where the orb was `lag` ago, so it shrinks away as the orb settles. */
interface Trail {
  max: number;
  lag: number;
  /** Points on its polyline. */
  points: number;
  opacity: Profile;
}

/** Drawn back to front. */
const TRAILS = {
  /** The wire the orb has just passed, brightened for a moment. */
  wake: { max: 180, lag: 0.3, points: 10, opacity: [[0, 0], [0.12, 1], [0.7, 0.75], [1, 0]] },
  /** The comet tail in the cable's color. */
  tail: { max: 66, lag: 0.14, points: 6, opacity: [[0, 0], [0.07, 1], [0.78, 0.9], [1, 0]] },
  /** The tail's hot center. */
  streak: { max: 28, lag: 0.06, points: 4, opacity: [[0, 0], [0.05, 1], [0.8, 0.9], [0.96, 0]] },
} satisfies Record<string, Trail>;

export type OrbTrail = keyof typeof TRAILS;
export const ORB_TRAILS = Object.keys(TRAILS) as OrbTrail[];

const TONE = { full: { opacity: 1, size: 1, trail: 1 }, dim: { opacity: 0.6, size: 0.62, trail: 0.6 } } as const;

/** Keyframe times: every 1/24 of the flight, plus every ~14 units along the cable (dense where the orb is fast). */
export function orbSampleTimes(length: number, ease: (t: number) => number = orbEase): number[] {
  const times: number[] = [];
  for (let i = 0; i <= 24; i++) times.push(i / 24);
  const steps = Math.min(48, Math.ceil(length / 14));
  for (let i = 1; i < steps; i++) times.push(invertEase(ease, i / steps));
  times.sort((a, b) => a - b);
  return times.filter((t, i) => i === 0 || t - times[i - 1]! > 1e-4);
}

export interface OrbPlan {
  duration: number;
  length: number;
  head: Keyframe[];
  trails: Record<OrbTrail, Keyframe[]>;
  /** A bloom and a spreading ring at the input, LANDING_MS long, starting `landing` ms into the flight. */
  bloom: Keyframe[];
  ring: Keyframe[];
  landing: number;
}

const round = (n: number) => Math.round(n * 100) / 100;
const px = (n: number) => `${round(n)}px`;

/** The stretch of `arc` between two distances as a CSS path() of `points` points (the same shape at every keyframe, so it interpolates). */
export function stretch(arc: CableArc, from: number, to: number, points: number): string {
  const parts: string[] = [];
  for (let i = 0; i < points; i++) {
    const [x, y] = arc.pointAt(from + ((to - from) * i) / (points - 1));
    parts.push(`${i ? "L" : "M"} ${round(x)} ${round(y)}`);
  }
  return `path("${parts.join(" ")}")`;
}

/**
 * Keyframes for one orb along `arc`: the head, the trails behind it, and the landing at the input.
 * The head moves by `cx` and `cy` rather than a transform: an animated transform on an SVG element
 * costs Chromium far more with a few dozen in flight, and can run on the compositor, where it pulls
 * ahead of the trails. Parts fade by fill-opacity and stroke-opacity for the same reason (see the
 * .sb-pe-orb rules in patch-editor.css).
 */
export function orbPlan(arc: CableArc, tone: OrbTone): OrbPlan {
  const { length } = arc;
  const duration = orbDuration(length);
  const look = TONE[tone];
  const head: Keyframe[] = [];
  const trails = Object.fromEntries(ORB_TRAILS.map((name) => [name, []])) as unknown as Record<OrbTrail, Keyframe[]>;
  for (const t of orbSampleTimes(length)) {
    const at = length * orbEase(t);
    const [x, y] = arc.pointAt(at);
    head.push({ offset: t, cx: px(x), cy: px(y), r: px(ORB_RADIUS * look.size * profileAt(HEAD_SIZE, t)), fillOpacity: round(look.opacity * profileAt(HEAD_OPACITY, t)) });
    for (const name of ORB_TRAILS) {
      const trail: Trail = TRAILS[name];
      const from = Math.max(0, at - trail.max * look.trail, t > trail.lag ? length * orbEase(t - trail.lag) : 0);
      trails[name].push({ offset: t, d: stretch(arc, from, at, trail.points), strokeOpacity: round(look.opacity * profileAt(trail.opacity, t)) });
    }
  }
  const size = look.size;
  const bloom: Keyframe[] = [
    { offset: 0, fillOpacity: 0, r: px(5 * size) },
    { offset: 0.12, fillOpacity: look.opacity, r: px(9 * size) },
    { offset: 1, fillOpacity: 0, r: px(20 * size) },
  ];
  const ring: Keyframe[] = [
    { offset: 0, strokeOpacity: 0, r: px(3 * size), strokeWidth: 1.8 },
    { offset: 0.1, strokeOpacity: round(0.8 * look.opacity), r: px(4.5 * size) },
    { offset: 1, strokeOpacity: 0, r: px(16 * size), strokeWidth: 0.3 },
  ];
  return { duration, length, head, trails, bloom, ring, landing: Math.round(duration * LANDING_AT) };
}
