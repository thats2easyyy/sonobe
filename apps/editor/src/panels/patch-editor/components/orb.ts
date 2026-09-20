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
/**
 * How far any point of an orb may stray from the wire between two keyframes (flow units). The
 * browser moves each point in a straight line from one keyframe to the next, which cuts across a bend.
 */
export const ORB_TOLERANCE = 0.8;

/**
 * Flight time for a cable of this length, so short and long cables feel alike: quick enough that the
 * orb reads as the change arriving, not as something after it (the value, the viewer and the port
 * dots change at once).
 */
export function orbDuration(length: number): number {
  return Math.round(Math.min(450, Math.max(180, 150 + length * 0.4)));
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
export const orbEase = tabulate(cubicBezier(0.2, 0.55, 0.45, 0.9));

/** `ease` looked up from `steps` samples rather than solved each time: planning an orb eases a few hundred times. */
export function tabulate(ease: (t: number) => number, steps = 512): (t: number) => number {
  const table = new Float64Array(steps + 1);
  for (let i = 0; i <= steps; i++) table[i] = ease(i / steps);
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const x = t * steps;
    const i = Math.floor(x);
    return table[i]! + (table[i + 1]! - table[i]!) * (x - i);
  };
}

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
  /** How far its direction has turned, all told (radians, left and right turns both counting), from the start to `distance`. */
  turnAt(distance: number): number;
  /**
   * `count` distances from `from` to `to`, closer together where the cable turns (a radian counting
   * as BEND_UNITS of length), so straight lines between them hug the bends.
   */
  spread(from: number, to: number, count: number, out?: Float64Array, offset?: number): Float64Array;
}

/** How much a radian of the cable's turning counts for when spreading points along it. */
export const BEND_UNITS = 60;

/**
 * Measure the cable from (sx, sy) to (tx, ty) (the curve cablePath draws), carried on `inset` units
 * straight past each end. The curve leaves and enters horizontally, so the extensions are seamless.
 */
export function cableArc(sx: number, sy: number, tx: number, ty: number, inset = 0, segments = 96): CableArc {
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
  // How far the tangent has turned by each point, and the two together, for spread().
  const turns = new Float64Array(count);
  const measures = new Float64Array(count);
  for (let i = 1; i < count; i++) {
    turns[i] = turns[i - 1]! + Math.acos(Math.min(1, dxs[i - 1]! * dxs[i]! + dys[i - 1]! * dys[i]!));
    measures[i] = lengths[i]! + BEND_UNITS * turns[i]!;
  }
  /** The piece that `distance` falls in. */
  const pieceAt = (distance: number): number => {
    if (distance <= 0) return 0;
    if (distance >= length) return last - 1;
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lengths[mid]! <= distance) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  /** How far into piece `lo` `distance` is, 0 to 1. */
  const along = (lo: number, distance: number) => (distance >= length ? 1 : distance <= 0 ? 0 : (distance - lengths[lo]!) / (lengths[lo + 1]! - lengths[lo]! || 1));
  const frameAt = (distance: number): [number, number, number, number] => {
    const lo = pieceAt(distance);
    const hi = lo + 1;
    const k = along(lo, distance);
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
    turnAt(distance) {
      const lo = pieceAt(distance);
      return turns[lo]! + (turns[lo + 1]! - turns[lo]!) * along(lo, distance);
    },
    spread(from, to, points, out = new Float64Array(points), offset = 0) {
      let lo = pieceAt(from);
      const m0 = measures[lo]! + (measures[lo + 1]! - measures[lo]!) * along(lo, from);
      const end = pieceAt(to);
      const m1 = measures[end]! + (measures[end + 1]! - measures[end]!) * along(end, to);
      // Within a piece, length and turning both grow evenly, so the measure maps back exactly.
      for (let i = 0; i < points; i++) {
        const m = m0 + ((m1 - m0) * i) / Math.max(points - 1, 1);
        while (lo < end && measures[lo + 1]! < m) lo++;
        const span = measures[lo + 1]! - measures[lo]!;
        const k = span > 1e-9 ? Math.min(1, Math.max(0, (m - measures[lo]!) / span)) : 0;
        out[offset + i] = Math.min(to, Math.max(from, lengths[lo]! + (lengths[lo + 1]! - lengths[lo]!) * k));
      }
      return out;
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
  /** The wire the orb has just passed, brightened for a moment: barely wider than the wire. */
  wake: { max: 170, lag: 0.34, width: 3, taper: 1.2, points: 8, opacity: (a) => [[0, 0], [0.1, 1], [a - 0.2, 0.7], [a + 0.04, 0]] },
  /** The comet's tail, in a brighter shade of the cable's color. */
  tail: { max: 84, lag: 0.16, width: 6.4, taper: 1, points: 8, opacity: (a) => [[0, 0], [0.05, 1], [a - 0.1, 0.95], [a + 0.04, 0]] },
  /** The tail's hot center. */
  streak: { max: 40, lag: 0.08, width: 2.6, taper: 0.8, points: 6, opacity: (a) => [[0, 0], [0.04, 1], [a - 0.08, 1], [a, 0]] },
} satisfies Record<string, Trail>;

export type OrbTrail = keyof typeof TRAILS;
export const ORB_TRAILS = Object.keys(TRAILS) as OrbTrail[];

/**
 * How each tone looks: its size, its trails' length and strength, and its landing's. A dim head's
 * fainter color is its own gradient (.sb-pe-orb__dim-* in patch-editor.css), set per theme.
 */
const TONE = {
  full: { size: 1, trail: 1, trailOpacity: 1, landing: 1 },
  dim: { size: 0.62, trail: 0.6, trailOpacity: 0.7, landing: 0.7 },
} as const;

/** The head's size and strength over the flight: it swells out of the output, then shrinks and fades as it sinks into the input. */
const headSize = (arrive: number): Profile => [
  [0, 0.45],
  [0.12, 1],
  [arrive - 0.12, 1],
  [1, 0.3],
];
const headOpacity = (arrive: number): Profile => [
  [0, 0],
  [0.05, 1],
  [arrive - 0.04, 1],
  [1, 0],
];

/**
 * Steps the sampler looks at, evenly spaced along the cable (the head covers its start fastest, and a
 * bend there needs as close a look as one anywhere): the densest keyframes can be.
 */
const SAMPLE_STEPS = 200;
/** However straight the cable, a keyframe at least this often, for the easing and the fades... */
const SAMPLE_EVERY = 1 / 12;
/** ...and every this many units the head moves. */
const SAMPLE_SPAN = 40;
/** A fade's turn this close to a keyframe (a fraction of the flight) is left to it. */
const SAMPLE_NEAR = 0.02;

/**
 * Keyframe times for an orb along `arc`. The browser moves each point in a straight line between
 * keyframes, and a chord of length c across a stretch of cable that turns by θ strays at most about
 * c·θ/4 from it. So they're closest together where the cable bends under the head, or under a point
 * of one of `trails` (spread along the wire from where the head was up to where it is, as ribbon()
 * spreads them), keeping every point within about ORB_TOLERANCE of the wire; at least every
 * SAMPLE_EVERY of the flight and SAMPLE_SPAN units of the head's travel; and at each of `breaks`,
 * where a fade or a swell turns. The head's keyframes need only the head; the trails' come later
 * (OrbPlan.trails), at times of their own.
 */
export function orbSampleTimes(arc: CableArc, trails: readonly { max: number; lag: number; points: number }[] = [], breaks: readonly number[] = [], ease: (t: number) => number = orbEase): number[] {
  const { length } = arc;
  const steps = SAMPLE_STEPS;
  // When the head is a step's length further along each time: `ease` inverted by walking it finely.
  const when = new Float64Array(steps + 1);
  const fine = steps * 8;
  for (let i = 1, k = 0, t0 = 0, p0 = 0; i <= fine && k < steps; i++) {
    const t1 = i / fine;
    const p1 = ease(t1);
    while (k < steps && p1 >= (k + 1) / steps) {
      k++;
      when[k] = t0 + ((t1 - t0) * (k / steps - p0)) / (p1 - p0 || 1);
    }
    t0 = t1;
    p0 = p1;
  }
  when[steps] = 1;
  // The points tracked, at step i: the head, then each trail's points (its front is the head's).
  const count = 1 + trails.reduce((n, trail) => n + trail.points, 0);
  const place = (i: number, out: Float64Array, turn: Float64Array) => {
    const t = when[i]!;
    const head = (length * i) / steps;
    out[0] = head;
    let n = 1;
    for (const trail of trails) {
      arc.spread(Math.max(0, head - trail.max, t > trail.lag ? length * ease(t - trail.lag) : 0), head, trail.points, out, n);
      n += trail.points;
    }
    for (let j = 0; j < count; j++) turn[j] = arc.turnAt(out[j]!);
  };
  // Where each was at the last keyframe, at the last step, and now; and how far the cable had turned there.
  let from = new Float64Array(count);
  let fromTurn = new Float64Array(count);
  let before = new Float64Array(count);
  let beforeTurn = new Float64Array(count);
  let now = new Float64Array(count);
  let nowTurn = new Float64Array(count);
  place(0, from, fromTurn);
  before.set(from);
  beforeTurn.set(fromTurn);
  const times = [0];
  let last = 0;
  for (let i = 1; i <= steps; i++) {
    place(i, now, nowTurn);
    let over = when[i]! - last > SAMPLE_EVERY + 1e-9 || now[0]! - from[0]! > SAMPLE_SPAN;
    for (let j = 0; j < count && !over; j++) over = (Math.abs(now[j]! - from[j]!) * Math.abs(nowTurn[j]! - fromTurn[j]!)) / 4 > ORB_TOLERANCE;
    if (over && when[i - 1]! > last) {
      last = when[i - 1]!;
      times.push(last);
      [from, before] = [before, from];
      [fromTurn, beforeTurn] = [beforeTurn, fromTurn];
    }
    [before, now] = [now, before];
    [beforeTurn, nowTurn] = [nowTurn, beforeTurn];
  }
  times.push(1);
  // A break close to a keyframe already there doesn't need one of its own.
  for (const t of breaks) if (t > 0 && t < 1 && !times.some((k) => Math.abs(k - t) < SAMPLE_NEAR)) times.push(t);
  return times.sort((a, b) => a - b);
}

/** When in the flight (0 to 1) the head comes within ORB_INSET of the end: it's reached the input's dot. */
export function arrivalTime(length: number, ease: (t: number) => number = orbEase): number {
  return Math.min(0.95, Math.max(0.8, invertEase(ease, 1 - ORB_INSET / Math.max(length, 2 * ORB_INSET))));
}

export interface OrbPlan {
  duration: number;
  length: number;
  /** The head's keyframe times, which the sweep shares. */
  times: number[];
  head: Keyframe[];
  /**
   * Worked out the first time they're asked for, since the head can leave without them (orbFlight.ts).
   * Their keyframes come at times of their own, where their points need them.
   */
  trails(): Record<OrbTrail, Keyframe[]>;
  /** How much of the cable, 0 to 1, the head has passed `t` into the flight (0 to 1). */
  front(t: number): number;
  /** A flare and a spreading ring on the input's dot, LANDING_MS long, starting `landing` ms into the flight. */
  flare: Keyframe[];
  ring: Keyframe[];
  landing: number;
}

const round = (n: number) => Math.round(n * 100) / 100;
/**
 * A trail's coordinates, to a tenth of a unit. Built from integers: turning fractions into strings is
 * most of the cost of an orb's trails, and this halves it.
 */
const tenth = (n: number) => {
  const i = Math.round(n * 10);
  const a = i < 0 ? -i : i;
  return `${i < 0 ? "-" : ""}${(a / 10) | 0}.${a % 10}`;
};
const px = (n: number) => `${round(n)}px`;

/**
 * The trail between two distances along `arc`, as a closed CSS path(): `points` points up one side
 * (closer together where the cable bends, so its straight edges hug the wire) and back down the
 * other, around a round nose past `to`. Every keyframe has the same number of points, so the browser
 * interpolates between them.
 */
export function ribbon(arc: CableArc, from: number, to: number, points: number, width: number, taper: number): string {
  const half = width / 2;
  const stations: [distance: number, half: number][] = [];
  arc.spread(from, to, points).forEach((distance, i) => stations.push([distance, half * (to > from ? (distance - from) / (to - from) : i / (points - 1)) ** taper]));
  stations.push([to + half * 0.55, half * 0.84], [to + half, 0]);
  const left: string[] = [];
  const right: string[] = [];
  for (const [distance, offset] of stations) {
    const [x, y, nx, ny] = arc.frameAt(distance);
    left.push(`${tenth(x + nx * offset)} ${tenth(y + ny * offset)}`);
    right.push(`${tenth(x - nx * offset)} ${tenth(y - ny * offset)}`);
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
  const size = headSize(arrive);
  const strength = headOpacity(arrive);
  const trailsOf = ORB_TRAILS.map((name) => ({ name, trail: TRAILS[name] as Trail, fade: (TRAILS[name] as Trail).opacity(arrive) }));
  const breaksOf = (...profiles: Profile[]) => profiles.flatMap((profile) => profile.map(([t]) => t));
  const times = orbSampleTimes(arc, [], breaksOf(size, strength));
  const head = times.map((t): Keyframe => {
    const [x, y] = arc.pointAt(length * orbEase(t));
    return { offset: t, cx: px(x), cy: px(y), r: px(ORB_RADIUS * look.size * profileAt(size, t)), fillOpacity: round(profileAt(strength, t)) };
  });
  let trails: Record<OrbTrail, Keyframe[]> | undefined;
  const flare: Keyframe[] = [
    { offset: 0, fillOpacity: 0, r: px(4 * look.size) },
    { offset: 0.14, fillOpacity: look.landing, r: px(8 * look.size) },
    { offset: 1, fillOpacity: 0, r: px(12 * look.size) },
  ];
  const ring: Keyframe[] = [
    { offset: 0, strokeOpacity: 0, r: px(4.5 * look.size), strokeWidth: 2 },
    { offset: 0.12, strokeOpacity: round(0.85 * look.landing), r: px(6 * look.size) },
    { offset: 1, strokeOpacity: 0, r: px(17 * look.size), strokeWidth: 0.4 },
  ];
  const wire = Math.max(length - 2 * ORB_INSET, 1);
  return {
    duration,
    length,
    times,
    head,
    trails() {
      if (trails) return trails;
      trails = {} as Record<OrbTrail, Keyframe[]>;
      const at = orbSampleTimes(
        arc,
        trailsOf.map(({ trail }) => ({ max: trail.max * look.trail, lag: trail.lag, points: trail.points })),
        breaksOf(...trailsOf.map((t) => t.fade)),
      );
      for (const { name, trail, fade } of trailsOf) {
        trails[name] = at.map((t) => {
          const head = length * orbEase(t);
          const from = Math.max(0, head - trail.max * look.trail, t > trail.lag ? length * orbEase(t - trail.lag) : 0);
          return { offset: t, d: ribbon(arc, from, head, trail.points, trail.width * look.size, trail.taper), fillOpacity: round(look.trailOpacity * profileAt(fade, t)) };
        });
      }
      return trails;
    },
    front: (t) => Math.min(1, Math.max(0, (length * orbEase(t) - ORB_INSET) / wire)),
    flare,
    ring,
    landing: Math.round(duration * (arrive - 0.03)),
  };
}

/** The sweep path's pathLength, so its dashes are fractions of the cable. */
export const SWEEP_LENGTH = 1000;

/** An earlier orb whose sweep is still going when the next one leaves: its plan, and how far into its flight it is (ms). */
export interface SweepBefore {
  plan: OrbPlan;
  elapsed: number;
}

/**
 * Keyframes that carry a boolean's glow along its cable with the orb (a stroke-dasharray on a copy
 * of the glow): lighting the wire behind the head for "on", darkening it for "off". When the one
 * before is still going (a quick tap), the new front chases the old one, so the lit stretch between
 * them travels on instead of jumping. The dashes light [0, a] and [a + b, a + b + c].
 */
export function sweepKeyframes(plan: OrbPlan, on: boolean, before?: SweepBefore): Keyframe[] {
  const all = SWEEP_LENGTH;
  return plan.times.map((t) => {
    const front = all * plan.front(t);
    const ahead = before ? all * before.plan.front(Math.min(1, (before.elapsed + t * plan.duration) / before.plan.duration)) : all;
    const gap = Math.max(0, ahead - front);
    const dashes = on ? [front, before ? gap : all, before ? all : 0] : [0, front, before ? gap : all];
    return { offset: t, strokeDasharray: `${dashes.map(round).join(" ")} ${all}` };
  });
}
