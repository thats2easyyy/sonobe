import { describe, expect, it } from "vitest";
import { arrivalTime, cableArc, cubicBezier, invertEase, LANDING_MS, orbDuration, orbEase, orbGap, orbPlan, orbSampleTimes, ORB_INSET, ORB_RADIUS, ORB_SLOTS, ORB_TRAILS, profileAt, ribbon } from "./orb.ts";

const px = (value: unknown) => Number(String(value).replace("px", ""));
const points = (d: unknown) => [...String(d).matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
/** A ribbon's stations: the midpoint and width across it at each point along it (the far end first). */
const stations = (d: unknown) => {
  const p = points(d);
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
  it("runs 0 to 1 in order, denser for longer cables, and stays small", () => {
    const short = orbSampleTimes(80);
    const long = orbSampleTimes(800);
    for (const times of [short, long]) {
      expect(times[0]).toBe(0);
      expect(times.at(-1)).toBe(1);
      for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    }
    expect(long.length).toBeGreaterThan(short.length);
    expect(orbSampleTimes(5000).length).toBeLessThanOrEqual(13 + 15);
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
      expect(keyframes.map((k) => k.offset)).toEqual(full.head.map((k) => k.offset));
      const size = points(keyframes[0]!.d).length;
      keyframes.forEach((k, i) => {
        expect(points(k.d)).toHaveLength(size);
        const s = stations(k.d);
        const head = s.at(-3)!;
        expect(head.x).toBeCloseTo(px(full.head[i]!.cx), 1);
        expect(head.y).toBeCloseTo(px(full.head[i]!.cy), 1);
        expect(s[0]!.width).toBeCloseTo(0, 1);
      });
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
    expect(Math.max(...dim.head.map((k) => px(k.r)))).toBeLessThan(ORB_RADIUS * 0.7);
    expect(Math.max(...dim.head.map((k) => Number(k.fillOpacity)))).toBeLessThan(0.7);
    expect(dim.duration).toBe(full.duration);
  });
});
