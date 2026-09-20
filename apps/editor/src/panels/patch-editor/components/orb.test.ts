import { describe, expect, it } from "vitest";
import { cableArc, createThrottle, cubicBezier, invertEase, LANDING_MS, orbDuration, orbEase, orbGap, orbPlan, orbSampleTimes, ORB_RADIUS, ORB_SLOTS, ORB_TRAILS, profileAt, stretch } from "./orb.ts";

const px = (value: unknown) => Number(String(value).replace("px", ""));
const points = (d: unknown) => [...String(d).matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);

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
    for (const duration of [300, 500, 900]) expect(orbGap(duration)).toBeGreaterThanOrEqual(duration / 2);
  });

  it("doesn't reuse a slot before its landing fades", () => {
    for (const duration of [300, 500, 900]) expect(orbGap(duration) * ORB_SLOTS).toBeGreaterThanOrEqual(Math.round(duration * 0.84) + LANDING_MS);
  });
});

describe("createThrottle", () => {
  it("lets one send through per gap and drops the rest", () => {
    const admit = createThrottle();
    const let_through = [0, 16, 33, 150, 160, 299, 300, 316].filter((now) => admit(now, 150));
    expect(let_through).toEqual([0, 150, 300]);
  });

  it("uses the gap it's given each time", () => {
    const admit = createThrottle();
    expect(admit(0, 0)).toBe(true);
    expect(admit(1, 0)).toBe(true);
    expect(admit(2, 400)).toBe(false);
  });
});

describe("easing", () => {
  it("matches CSS cubic-bezier at the ends and in between", () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (const t of [0, 0.25, 0.5, 0.9, 1]) expect(linear(t)).toBeCloseTo(t, 4);
    // CSS "ease" is cubic-bezier(0.25, 0.1, 0.25, 1); at t = 0.5 it's about 0.8024.
    expect(cubicBezier(0.25, 0.1, 0.25, 1)(0.5)).toBeCloseTo(0.8024, 3);
  });

  it("leaves the output quickly and settles into the input", () => {
    expect(orbEase(0.1)).toBeGreaterThan(0.2);
    expect(orbEase(0.9) - orbEase(0.8)).toBeLessThan(0.05);
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
  it("runs 0 to 1 in order, denser for longer cables", () => {
    const short = orbSampleTimes(80);
    const long = orbSampleTimes(800);
    for (const times of [short, long]) {
      expect(times[0]).toBe(0);
      expect(times.at(-1)).toBe(1);
      for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    }
    expect(long.length).toBeGreaterThan(short.length);
    expect(long.length).toBeLessThanOrEqual(25 + 48);
  });
});

describe("stretch", () => {
  it("is a path() with the same number of points at any length, so keyframes interpolate", () => {
    const arc = cableArc(0, 0, 300, 0);
    const a = stretch(arc, 10, 60, 5);
    const b = stretch(arc, 0, 0, 5);
    expect(a).toMatch(/^path\("M [\d.]+ [\d.]+( L [\d.]+ [\d.]+){4}"\)$/);
    expect(points(a)).toHaveLength(5);
    expect(points(b)).toHaveLength(5);
    expect(points(a)[0]![0]).toBeCloseTo(10, 0);
    expect(points(a)[4]![0]).toBeCloseTo(60, 0);
  });
});

describe("orbPlan", () => {
  const arc = cableArc(100, 50, 520, 260);
  const full = orbPlan(arc, "full");
  const dim = orbPlan(arc, "dim");

  it("flies from the output to the input, taking the cable's duration", () => {
    expect(full.duration).toBe(orbDuration(arc.length));
    const first = full.head[0]!;
    const last = full.head.at(-1)!;
    expect(first.offset).toBe(0);
    expect(last.offset).toBe(1);
    expect([px(first.cx), px(first.cy)]).toEqual([100, 50]);
    expect([px(last.cx), px(last.cy)]).toEqual([520, 260]);
  });

  it("fades the head in and out and keeps it at most ORB_RADIUS", () => {
    expect(full.head[0]!.fillOpacity).toBe(0);
    expect(full.head.at(-1)!.fillOpacity).toBe(0);
    expect(Math.max(...full.head.map((k) => Number(k.fillOpacity)))).toBe(1);
    expect(Math.max(...full.head.map((k) => px(k.r)))).toBe(ORB_RADIUS);
  });

  it("keeps each trail behind the head, touching it", () => {
    for (const name of ORB_TRAILS) {
      const keyframes = full.trails[name];
      expect(keyframes.map((k) => k.offset)).toEqual(full.head.map((k) => k.offset));
      keyframes.forEach((k, i) => {
        const tip = points(k.d).at(-1)!;
        expect(tip[0]).toBeCloseTo(px(full.head[i]!.cx), 1);
        expect(tip[1]).toBeCloseTo(px(full.head[i]!.cy), 1);
      });
    }
  });

  it("shrinks the trails away as the orb settles", () => {
    const tail = full.trails.tail;
    const spread = (d: unknown) => {
      const p = points(d);
      return Math.hypot(p.at(-1)![0] - p[0]![0], p.at(-1)![1] - p[0]![1]);
    };
    const middle = tail[Math.floor(tail.length / 3)]!;
    expect(spread(middle.d)).toBeGreaterThan(20);
    expect(spread(tail.at(-1)!.d)).toBeLessThan(3);
    expect(tail.at(-1)!.strokeOpacity).toBe(0);
  });

  it("lands near the end of the flight", () => {
    expect(full.landing).toBeGreaterThan(full.duration * 0.7);
    expect(full.landing).toBeLessThan(full.duration);
    expect(full.bloom[0]!.fillOpacity).toBe(0);
    expect(full.ring.at(-1)!.strokeOpacity).toBe(0);
  });

  it("sends a smaller, fainter orb for a boolean turning off", () => {
    expect(Math.max(...dim.head.map((k) => px(k.r)))).toBeLessThan(ORB_RADIUS * 0.7);
    expect(Math.max(...dim.head.map((k) => Number(k.fillOpacity)))).toBeLessThan(0.7);
    expect(dim.duration).toBe(full.duration);
  });
});
