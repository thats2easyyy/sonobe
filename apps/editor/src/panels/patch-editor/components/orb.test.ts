import { describe, expect, it } from "vitest";
import { cablePoint } from "../model/geometry.ts";
import { arrivalTime, cableArc, cubicBezier, invertEase, LANDING_MS, orbDuration, orbEase, orbGap, orbPlan, orbSampleTimes, ORB_INSET, ORB_RADIUS, ORB_SLOTS, ORB_TRAILS, profileAt, ribbon, sweepKeyframes, SWEEP_LENGTH, tabulate } from "./orb.ts";

const px = (value: unknown) => Number(String(value).replace("px", ""));
const points = (d: unknown) => [...String(d).matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
/** How far (x, y) is from the cable drawn from (sx, sy) to (tx, ty), carried on ORB_INSET past each end. */
function offWire(sx: number, sy: number, tx: number, ty: number) {
  const curve: [number, number][] = [];
  for (let i = 0; i <= 3000; i++) curve.push(cablePoint(i / 3000, sx, sy, tx, ty));
  for (let k = 0; k <= ORB_INSET; k += 0.25) curve.push([sx - k, sy], [tx + k, ty]);
  return (x: number, y: number) => Math.sqrt(Math.min(...curve.map(([cx, cy]) => (cx - x) ** 2 + (cy - y) ** 2)));
}
/** Keyframes' value `pick` at time t, as the browser plays them: straight lines between keyframes. */
function between<T>(keyframes: Keyframe[], t: number, pick: (k: Keyframe) => T, lerp: (a: T, b: T, u: number) => T): T {
  let i = keyframes.findIndex((k) => Number(k.offset) > t) - 1;
  if (i < 0) i = keyframes.length - 2;
  const [a, b] = [keyframes[i]!, keyframes[i + 1]!];
  return lerp(pick(a), pick(b), (t - Number(a.offset)) / (Number(b.offset) - Number(a.offset)));
}
const lerpPoints = (a: (readonly [number, number])[], b: (readonly [number, number])[], u: number) => a.map(([x, y], i) => [x + (b[i]![0] - x) * u, y + (b[i]![1] - y) * u] as const);
/** A ribbon's stations: the midpoint and width across it at each point along it (the far end first). */
const stations = (d: unknown) => sides(points(d));
const sides = (p: readonly (readonly [number, number])[]) => {
  const m = p.length / 2;
  return Array.from({ length: m }, (_, i) => {
    const [a, b] = [p[i]!, p[p.length - 1 - i]!];
    return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, width: Math.hypot(a[0] - b[0], a[1] - b[1]) };
  });
};

describe("orbDuration", () => {
  it("grows with the cable and stays between 300 and 900 ms", () => {
    expect(orbDuration(0)).toBe(300);
    expect(orbDuration(100)).toBe(300);
    expect(orbDuration(400)).toBe(440);
    expect(orbDuration(600)).toBe(550);
    expect(orbDuration(5000)).toBe(900);
  });
});

describe("orbGap", () => {
  it("keeps at most two orbs in flight", () => {
    for (const duration of [300, 500, 900]) expect(orbGap(duration, duration + LANDING_MS)).toBeGreaterThanOrEqual(duration / 2);
  });

  it("doesn't reuse a slot before its landing fades", () => {
    for (const duration of [300, 500, 900]) {
      const done = Math.round(duration * 0.9) + LANDING_MS;
      expect(orbGap(duration, done) * ORB_SLOTS).toBeGreaterThanOrEqual(done);
    }
  });
});

describe("easing", () => {
  it("matches CSS cubic-bezier at the ends and in between", () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (const t of [0, 0.25, 0.5, 0.9, 1]) expect(linear(t)).toBeCloseTo(t, 4);
    // CSS "ease" is cubic-bezier(0.25, 0.1, 0.25, 1); at t = 0.5 it's about 0.8024.
    expect(cubicBezier(0.25, 0.1, 0.25, 1)(0.5)).toBeCloseTo(0.8024, 3);
  });

  it("leaves the output quickly and doesn't hover short of the input", () => {
    expect(orbEase(0.1)).toBeGreaterThan(0.2);
    // The last tenth of the cable takes about a third of the flight, not half of it.
    expect(1 - invertEase(orbEase, 0.9)).toBeLessThan(0.36);
    // Still moving as it reaches the input.
    expect(orbEase(1) - orbEase(0.95)).toBeGreaterThan(0.008);
    let previous = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      expect(orbEase(t)).toBeGreaterThanOrEqual(previous);
      previous = orbEase(t);
    }
  });

  it("inverts", () => {
    for (const progress of [0.1, 0.5, 0.95]) expect(orbEase(invertEase(orbEase, progress))).toBeCloseTo(progress, 5);
  });

  it("is looked up from a table that matches the curve", () => {
    const exact = cubicBezier(0.2, 0.55, 0.45, 0.9);
    const table = tabulate(exact);
    for (let t = 0; t <= 1; t += 0.037) expect(table(t)).toBeCloseTo(exact(t), 4);
    expect(table(0)).toBe(0);
    expect(table(1)).toBe(1);
  });
});

describe("cableArc", () => {
  it("measures a straight cable exactly", () => {
    const arc = cableArc(0, 0, 300, 0);
    expect(arc.length).toBeCloseTo(300, 6);
    expect(arc.pointAt(0)).toEqual([0, 0]);
    expect(arc.pointAt(150)[0]).toBeCloseTo(150, 0);
    expect(arc.pointAt(999)).toEqual([300, 0]);
  });

  it("follows the curve by distance, not by curve parameter", () => {
    const arc = cableArc(0, 0, 400, 300);
    expect(arc.length).toBeGreaterThan(500);
    const step = arc.length / 10;
    for (let i = 0; i < 10; i++) {
      const [ax, ay] = arc.pointAt(step * i);
      const [bx, by] = arc.pointAt(step * (i + 1));
      expect(Math.hypot(bx - ax, by - ay)).toBeCloseTo(step, 0);
    }
  });

  it("carries on straight past each end, into the port dots", () => {
    const plain = cableArc(100, 50, 520, 260);
    const inset = cableArc(100, 50, 520, 260, ORB_INSET);
    expect(inset.length).toBeCloseTo(plain.length + 2 * ORB_INSET, 1);
    expect(inset.pointAt(0)).toEqual([100 - ORB_INSET, 50]);
    expect(inset.pointAt(ORB_INSET)[0]).toBeCloseTo(100, 1);
    expect(inset.pointAt(inset.length)).toEqual([520 + ORB_INSET, 260]);
  });

  it("counts how far the cable has turned", () => {
    const straight = cableArc(0, 0, 300, 0, ORB_INSET);
    expect(straight.turnAt(straight.length)).toBeCloseTo(0, 6);
    // An S-bend turns down and back level: about twice its steepest angle, all told.
    const bend = cableArc(0, 0, 60, 500, ORB_INSET);
    let previous = 0;
    for (let d = 0; d <= bend.length; d += 10) {
      expect(bend.turnAt(d)).toBeGreaterThanOrEqual(previous);
      previous = bend.turnAt(d);
    }
    expect(bend.turnAt(bend.length)).toBeGreaterThan(2.4);
    expect(bend.turnAt(bend.length)).toBeLessThan(Math.PI + 0.1);
  });

  it("spreads points closer together where it bends", () => {
    const straight = cableArc(0, 0, 300, 0);
    const even = [...straight.spread(20, 220, 5)];
    even.forEach((d, i) => expect(d).toBeCloseTo(20 + 50 * i, 6));
    const bend = cableArc(0, 0, 60, 500, ORB_INSET);
    const along = [...bend.spread(0, 200, 8)];
    expect(along[0]).toBe(0);
    expect(along.at(-1)).toBeCloseTo(200, 6);
    const gaps = along.slice(1).map((d, i) => d - along[i]!);
    // The first stretch, round the bend out of the output, gets the closest points.
    expect(Math.min(...gaps)).toBeLessThan(Math.max(...gaps) / 2);
    expect(gaps.indexOf(Math.min(...gaps))).toBeLessThan(3);
  });

  it("gives unit normals across the direction of travel", () => {
    const arc = cableArc(0, 0, 400, 300, ORB_INSET);
    expect(arc.normalAt(0)[0]).toBeCloseTo(0, 6);
    expect(Math.abs(arc.normalAt(0)[1])).toBeCloseTo(1, 6);
    for (const distance of [40, arc.length / 2, arc.length - 40]) {
      const [nx, ny] = arc.normalAt(distance);
      const [ax, ay] = arc.pointAt(distance - 1);
      const [bx, by] = arc.pointAt(distance + 1);
      expect(Math.hypot(nx, ny)).toBeCloseTo(1, 6);
      expect((nx * (bx - ax) + ny * (by - ay)) / Math.hypot(bx - ax, by - ay)).toBeCloseTo(0, 1);
    }
  });
});

describe("profileAt", () => {
  it("interpolates between points and holds past the ends", () => {
    const profile = [
      [0.2, 0],
      [0.6, 1],
    ] as const;
    expect(profileAt(profile, 0)).toBe(0);
    expect(profileAt(profile, 0.4)).toBeCloseTo(0.5);
    expect(profileAt(profile, 1)).toBe(1);
  });
});

describe("orbSampleTimes", () => {
  const trails = [{ max: 120, lag: 0.3, points: 8 }];

  it("runs 0 to 1 in order, and has a keyframe at each break", () => {
    for (const arc of [cableArc(0, 0, 80, 10, ORB_INSET), cableArc(0, 0, 900, 200, ORB_INSET), cableArc(0, 0, 60, 500, ORB_INSET)]) {
      const times = orbSampleTimes(arc, trails, [0.37]);
      expect(times[0]).toBe(0);
      expect(times.at(-1)).toBe(1);
      for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
      expect(times.some((t) => Math.abs(t - 0.37) < 0.021)).toBe(true);
    }
  });

  it("comes closer together where the cable bends, and stays small", () => {
    const flat = orbSampleTimes(cableArc(0, 0, 500, 0, ORB_INSET), trails);
    const steep = orbSampleTimes(cableArc(0, 0, 60, 500, ORB_INSET), trails);
    expect(steep.length).toBeGreaterThan(flat.length);
    // A cable doubling back on itself is about the worst.
    expect(orbSampleTimes(cableArc(0, 0, -300, 120, ORB_INSET), trails).length).toBeLessThan(60);
    // A straight one needs only the easing's.
    expect(flat.length).toBeLessThanOrEqual(20);
  });
});

describe("arrivalTime", () => {
  it("is when the head is in the input's dot", () => {
    for (const length of [60, 300, 1200]) {
      const t = arrivalTime(length);
      expect(t).toBeGreaterThanOrEqual(0.8);
      expect(t).toBeLessThanOrEqual(0.95);
      if (t > 0.8 && t < 0.95) expect(length * (1 - orbEase(t))).toBeCloseTo(ORB_INSET, 0);
    }
  });
});

describe("ribbon", () => {
  const arc = cableArc(0, 0, 300, 0);

  it("is a closed path() with the same number of points at any length, so keyframes interpolate", () => {
    const a = ribbon(arc, 10, 60, 5, 6, 1);
    const b = ribbon(arc, 0, 0, 5, 6, 1);
    expect(a).toMatch(/^path\("M [\d.-]+ [\d.-]+( L [\d.-]+ [\d.-]+)+ Z"\)$/);
    expect(points(a)).toHaveLength(points(b).length);
  });

  it("tapers from a point at its far end to its full width at the head, with a round nose past it", () => {
    const s = stations(ribbon(arc, 10, 60, 5, 6, 1));
    expect(s[0]).toMatchObject({ x: 10, y: 0, width: 0 });
    expect(s[4]!.x).toBeCloseTo(60, 1);
    expect(s[4]!.width).toBeCloseTo(6, 1);
    for (let i = 1; i <= 4; i++) expect(s[i]!.width).toBeGreaterThan(s[i - 1]!.width);
    expect(s.at(-1)!.width).toBe(0);
    expect(s.at(-1)!.x).toBeCloseTo(63, 1);
  });
});

describe("orbPlan", () => {
  const arc = cableArc(100, 50, 520, 260, ORB_INSET);
  const full = orbPlan(arc, "full");
  const dim = orbPlan(arc, "dim");

  it("flies from the output's dot to the input's, taking the cable's duration", () => {
    expect(full.duration).toBe(orbDuration(arc.length));
    const first = full.head[0]!;
    const last = full.head.at(-1)!;
    expect(first.offset).toBe(0);
    expect(last.offset).toBe(1);
    expect([px(first.cx), px(first.cy)]).toEqual([100 - ORB_INSET, 50]);
    expect([px(last.cx), px(last.cy)]).toEqual([520 + ORB_INSET, 260]);
  });

  it("fades the head in and out and keeps it at most ORB_RADIUS", () => {
    expect(full.head[0]!.fillOpacity).toBe(0);
    expect(full.head.at(-1)!.fillOpacity).toBe(0);
    expect(Math.max(...full.head.map((k) => Number(k.fillOpacity)))).toBe(1);
    expect(Math.max(...full.head.map((k) => px(k.r)))).toBe(ORB_RADIUS);
    expect(px(full.head.at(-1)!.r)).toBeLessThan(ORB_RADIUS / 2);
  });

  it("keeps each trail behind the head, its widest point on it", () => {
    for (const name of ORB_TRAILS) {
      const keyframes = full.trails()[name];
      expect(keyframes[0]!.offset).toBe(0);
      expect(keyframes.at(-1)!.offset).toBe(1);
      const size = points(keyframes[0]!.d).length;
      for (const k of keyframes) {
        expect(points(k.d)).toHaveLength(size);
        const s = stations(k.d);
        const front = s.at(-3)!;
        const [hx, hy] = arc.pointAt(arc.length * orbEase(Number(k.offset)));
        expect(front.x).toBeCloseTo(hx, 0);
        expect(front.y).toBeCloseTo(hy, 0);
        expect(s[0]!.width).toBeCloseTo(0, 1);
      }
    }
  });

  it("stays on the wire between keyframes, round a tight bend too", () => {
    // Tick to a node straight below it, which cut across the bend: the head was 7 units off it.
    for (const [sx, sy, tx, ty] of [
      [100, 50, 160, 550],
      [100, 50, 80, 350],
      [100, 50, -200, 170],
      [100, 50, 380, -10],
    ] as const) {
      const bent = cableArc(sx, sy, tx, ty, ORB_INSET);
      const plan = orbPlan(bent, "full");
      const trails = plan.trails();
      const off = offWire(sx, sy, tx, ty);
      let worst = 0;
      for (let t = 0; t <= 1; t += 1 / 150) {
        const [x, y] = between(plan.head, t, (k) => [px(k.cx), px(k.cy)] as const, (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u] as const);
        worst = Math.max(worst, off(x, y));
        for (const name of ORB_TRAILS) {
          if (between(trails[name], t, (k) => Number(k.fillOpacity), (a, b, u) => a + (b - a) * u) < 0.05) continue;
          const middle = sides(between(trails[name], t, (k) => points(k.d), lerpPoints)).slice(0, -2);
          // Each point's midline, and halfway along the straight edge to the next.
          middle.forEach((m, i) => {
            worst = Math.max(worst, off(m.x, m.y));
            const next = middle[i + 1];
            if (next) worst = Math.max(worst, off((m.x + next.x) / 2, (m.y + next.y) / 2));
          });
        }
      }
      expect(worst).toBeLessThan(1.2);
    }
  });

  it("shrinks the trails away and fades them as the orb settles", () => {
    const tail = full.trails().tail;
    const spread = (d: unknown) => {
      const s = stations(d);
      return Math.hypot(s.at(-3)!.x - s[0]!.x, s.at(-3)!.y - s[0]!.y);
    };
    const middle = tail[Math.floor(tail.length / 3)]!;
    expect(spread(middle.d)).toBeGreaterThan(20);
    expect(spread(tail.at(-1)!.d)).toBeLessThan(spread(middle.d));
    for (const name of ORB_TRAILS) expect(full.trails()[name].at(-1)!.fillOpacity).toBe(0);
  });

  it("lands on the input's dot near the end of the flight", () => {
    expect(full.landing).toBeGreaterThan(full.duration * 0.7);
    expect(full.landing).toBeLessThan(full.duration);
    expect(full.flare[0]!.fillOpacity).toBe(0);
    expect(full.flare.at(-1)!.fillOpacity).toBe(0);
    expect(full.ring.at(-1)!.strokeOpacity).toBe(0);
  });

  it("sends a smaller, fainter orb for a boolean turning off", () => {
    // Its head's fainter color is a gradient of its own, per theme (patch-editor.css).
    expect(Math.max(...dim.head.map((k) => px(k.r)))).toBeLessThan(ORB_RADIUS * 0.7);
    for (const name of ORB_TRAILS) expect(Math.max(...dim.trails()[name].map((k) => Number(k.fillOpacity)))).toBeLessThan(0.8);
    expect(Math.max(...dim.flare.map((k) => Number(k.fillOpacity)))).toBeLessThan(0.8);
    expect(dim.duration).toBe(full.duration);
  });

  it("measures how much of the wire the head has passed", () => {
    expect(full.front(0)).toBe(0);
    expect(full.front(1)).toBe(1);
    expect(full.front(0.5)).toBeGreaterThan(0.5);
    let previous = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      expect(full.front(t)).toBeGreaterThanOrEqual(previous);
      previous = full.front(t);
    }
  });
});

describe("sweepKeyframes", () => {
  const plan = orbPlan(cableArc(100, 50, 520, 260, ORB_INSET), "full");
  /** The stretches a keyframe's dashes light, as fractions of the cable: [0, a] and [a + b, a + b + c]. */
  const lit = (k: Keyframe) => {
    const [a, b, c, gap] = String(k.strokeDasharray).split(" ").map(Number) as [number, number, number, number];
    expect(gap).toBe(SWEEP_LENGTH);
    return [
      [0, a / SWEEP_LENGTH],
      [(a + b) / SWEEP_LENGTH, Math.min(1, (a + b + c) / SWEEP_LENGTH)],
    ].filter(([from, to]) => to - from > 1e-6);
  };

  it("lights the wire behind the head for a boolean turning on", () => {
    const keyframes = sweepKeyframes(plan, true);
    expect(keyframes.map((k) => k.offset)).toEqual(plan.times);
    expect(lit(keyframes[0]!)).toEqual([]);
    expect(lit(keyframes.at(-1)!)).toEqual([[0, 1]]);
    for (const k of keyframes.slice(1, -1)) {
      const [first, ...rest] = lit(k);
      expect(rest).toEqual([]);
      expect(first![0]).toBe(0);
      expect(first![1]).toBeCloseTo(plan.front(Number(k.offset)), 4);
    }
  });

  it("darkens it behind the head for one turning off", () => {
    const keyframes = sweepKeyframes(plan, false);
    expect(lit(keyframes[0]!)).toEqual([[0, 1]]);
    expect(lit(keyframes.at(-1)!)).toEqual([]);
    const middle = keyframes[Math.floor(keyframes.length / 2)]!;
    const [only] = lit(middle);
    expect(only![0]).toBeCloseTo(plan.front(Number(middle.offset)), 4);
    expect(only![1]).toBe(1);
  });

  it("lets the lit stretch between a quick tap's two orbs travel on", () => {
    // Off 150 ms after on: lit from the second head up to the first.
    const elapsed = 150;
    const keyframes = sweepKeyframes(plan, false, { plan, elapsed });
    for (const k of keyframes) {
      const t = Number(k.offset);
      const stretch = lit(k);
      const first = plan.front(Math.min(1, (elapsed + t * plan.duration) / plan.duration));
      if (first - plan.front(t) < 1e-3) continue;
      expect(stretch).toHaveLength(1);
      expect(stretch[0]![0]).toBeCloseTo(plan.front(t), 3);
      expect(stretch[0]![1]).toBeCloseTo(first, 3);
    }
    expect(lit(keyframes.at(-1)!)).toEqual([]);
    // And on again, after an off: lit behind the new head and ahead of the old one's.
    const again = sweepKeyframes(plan, true, { plan, elapsed });
    const middle = again[Math.floor(again.length / 3)]!;
    const stretches = lit(middle);
    expect(stretches[0]![0]).toBe(0);
    expect(stretches.at(-1)![1]).toBe(1);
    expect(lit(again.at(-1)!)).toEqual([[0, 1]]);
  });
});
