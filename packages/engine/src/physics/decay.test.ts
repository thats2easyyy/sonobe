import { describe, expect, it } from "vitest";
import {
  DECELERATION_FAST,
  DECELERATION_NORMAL,
  decayDuration,
  decayFinalPosition,
  decayPosition,
  decayTimeToReach,
  decayVelocity,
  DEFAULT_END_BOUNDARY,
  inverseRubberBand,
  inverseRubberBandClamp,
  MomentumScroller,
  rubberBand,
  rubberBandClamp,
} from "./decay.ts";

function runUntilIdle(
  scroller: MomentumScroller,
  dt = 1 / 60,
  maxSeconds = 30,
): { frames: number; min: number; max: number } {
  let frames = 0;
  let min = scroller.value;
  let max = scroller.value;
  while (scroller.phase !== "idle") {
    scroller.step(dt);
    min = Math.min(min, scroller.value);
    max = Math.max(max, scroller.value);
    frames++;
    if (frames > maxSeconds / dt) throw new Error(`did not settle (phase ${scroller.phase})`);
  }
  return { frames, min, max };
}

describe("POP decay closed form", () => {
  it("matches the per-millisecond decay loop (independent reference)", () => {
    const golden: [number, number, number][] = [
      [100, 181.070328920949, 1637.133609376854],
      [250, 392.98538870309113, 1212.4541308555274],
      [500, 631.2237676525552, 735.0225097143168],
    ];
    for (const [ms, x, v] of golden) {
      expect(decayPosition(0, 2000, DECELERATION_NORMAL, ms / 1000)).toBeCloseTo(x, 8);
      expect(decayVelocity(2000, DECELERATION_NORMAL, ms / 1000)).toBeCloseTo(v, 8);
    }
    expect(decayFinalPosition(0, 2000, DECELERATION_NORMAL)).toBeCloseTo(998, 9);
    expect(decayFinalPosition(10, -1000, DECELERATION_FAST)).toBeCloseTo(10 - 99, 9);
  });

  it("is frame-rate independent", () => {
    let x = 0;
    let v = 1500;
    for (let i = 0; i < 90; i++) {
      x = decayPosition(x, v, DECELERATION_NORMAL, 1 / 120);
      v = decayVelocity(v, DECELERATION_NORMAL, 1 / 120);
    }
    expect(x).toBeCloseTo(decayPosition(0, 1500, DECELERATION_NORMAL, 0.75), 9);
  });

  it("duration uses POP's threshold × 5 stop speed", () => {
    const d = decayDuration(2000, DECELERATION_NORMAL);
    expect(decayVelocity(2000, DECELERATION_NORMAL, d)).toBeCloseTo(0.005, 9);
    expect(decayDuration(0.001, DECELERATION_NORMAL)).toBe(0);
  });

  it("time to reach a target lands exactly on it, or null when unreachable", () => {
    const t = decayTimeToReach(0, 2000, DECELERATION_NORMAL, 500)!;
    expect(decayPosition(0, 2000, DECELERATION_NORMAL, t)).toBeCloseTo(500, 9);
    expect(decayTimeToReach(0, 2000, DECELERATION_NORMAL, 2000)).toBeNull();
    expect(decayTimeToReach(0, -2000, DECELERATION_NORMAL, 100)).toBeNull();
    expect(decayTimeToReach(5, 100, DECELERATION_NORMAL, 5)).toBe(0);
  });

  it("handles no deceleration and full stop", () => {
    expect(decayPosition(0, 100, 1, 2)).toBe(200);
    expect(decayPosition(0, 100, 0, 2)).toBe(0);
    expect(decayVelocity(100, 0, 1)).toBe(0);
    expect(decayTimeToReach(0, 50, 1, 100)).toBe(2);
  });
});

describe("rubber band", () => {
  it("resists and approaches the viewport size", () => {
    expect(rubberBand(0, 400)).toBe(0);
    expect(rubberBand(1, 400)).toBeCloseTo(0.55, 2);
    expect(rubberBand(100, 400)).toBeLessThan(100 * 0.55);
    expect(rubberBand(100000, 400)).toBeLessThan(400);
    expect(rubberBand(-100, 400)).toBe(-rubberBand(100, 400));
    let prev = 0;
    for (let x = 10; x < 2000; x += 10) {
      const v = rubberBand(x, 400);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it("inverts", () => {
    for (const x of [-800, -50, 3, 250, 1200]) {
      expect(inverseRubberBand(rubberBand(x, 390), 390)).toBeCloseTo(x, 6);
      expect(inverseRubberBandClamp(rubberBandClamp(x, 0, 100, 390), 0, 100, 390)).toBeCloseTo(
        x,
        6,
      );
    }
    expect(rubberBandClamp(50, 0, 100, 390)).toBe(50);
  });
});

describe("MomentumScroller", () => {
  it("defaults the end boundary to 99999", () => {
    expect(new MomentumScroller().options.max).toBe(DEFAULT_END_BOUNDARY);
  });

  it("drag → release with velocity → decay → rest at the projected position", () => {
    const scroller = new MomentumScroller({ min: -1e6, max: 1e6 });
    scroller.beginDrag();
    scroller.dragTo(-50);
    expect(scroller.value).toBe(-50);
    scroller.release(-2000);
    expect(scroller.phase).toBe("decelerating");
    runUntilIdle(scroller);
    expect(scroller.velocity).toBe(0);
    expect(scroller.value).toBeCloseTo(-50 + decayFinalPosition(0, -2000, DECELERATION_NORMAL), 0);
  });

  it("flinging into a bound overshoots then rubber-bands back exactly to the bound", () => {
    const scroller = new MomentumScroller({ min: 0, max: 500 }, 400);
    scroller.beginDrag();
    scroller.release(3000);
    const { max } = runUntilIdle(scroller);
    expect(max).toBeGreaterThan(510);
    expect(scroller.value).toBe(500);
    expect(scroller.phase).toBe("idle");
  });

  it("stick to boundaries stops hard at the bound", () => {
    const scroller = new MomentumScroller({ min: 0, max: 500, stickToBoundaries: true }, 400);
    scroller.beginDrag();
    scroller.dragTo(-500);
    expect(scroller.value).toBe(0);
    scroller.dragTo(100);
    scroller.release(3000);
    const { max } = runUntilIdle(scroller);
    expect(max).toBe(500);
    expect(scroller.value).toBe(500);
  });

  it("dragging past a bound resists, and release springs back", () => {
    const scroller = new MomentumScroller({ min: 0, max: 100, viewportSize: 400 });
    scroller.beginDrag();
    scroller.dragTo(-200);
    expect(scroller.value).toBeLessThan(0);
    expect(scroller.value).toBeGreaterThan(-200 * 0.55);
    // Re-grabbing while overscrolled continues from the same raw position.
    const raw = scroller.value;
    scroller.release(0);
    expect(scroller.phase).toBe("rubberBanding");
    scroller.beginDrag();
    scroller.dragTo(0);
    expect(scroller.value).toBeCloseTo(raw, 9);
    scroller.release(0);
    runUntilIdle(scroller);
    expect(scroller.value).toBe(0);
  });

  it("paging snaps to the nearest page and limits a fling to one page", () => {
    const scroller = new MomentumScroller({ min: 0, max: 900, pageSize: 300 });
    scroller.beginDrag();
    scroller.dragTo(80);
    scroller.release(0);
    expect(scroller.phase).toBe("snapping");
    runUntilIdle(scroller);
    expect(scroller.value).toBe(0);

    scroller.beginDrag();
    scroller.dragTo(200);
    scroller.release(0);
    runUntilIdle(scroller);
    expect(scroller.value).toBe(300);
    expect(scroller.page).toBe(1);

    scroller.beginDrag();
    scroller.dragTo(40);
    scroller.release(2500);
    runUntilIdle(scroller);
    expect(scroller.value).toBe(600);

    scroller.beginDrag();
    scroller.dragTo(10);
    scroller.release(50000);
    runUntilIdle(scroller);
    expect(scroller.value).toBe(900);
  });

  it("momentum off stops on release", () => {
    const scroller = new MomentumScroller({ min: 0, max: 1000, momentum: false }, 100);
    scroller.beginDrag();
    scroller.release(2000);
    expect(scroller.phase).toBe("idle");
    expect(scroller.step(1 / 60)).toBe(100);
  });

  it("track() estimates velocity for release()", () => {
    const scroller = new MomentumScroller({ min: -1e5, max: 1e5 });
    for (let i = 0; i <= 30; i++) {
      scroller.track(i * 10);
      scroller.step(1 / 60);
    }
    expect(scroller.velocity).toBeCloseTo(600, 0);
    scroller.release();
    expect(scroller.phase).toBe("decelerating");
    scroller.step(1 / 60);
    expect(scroller.value).toBeGreaterThan(300);
  });

  it("shrinking the bounds settles an out-of-range value", () => {
    const scroller = new MomentumScroller({ min: 0, max: 1000 }, 800);
    scroller.setOptions({ max: 500 });
    scroller.step(1 / 60);
    expect(scroller.phase).toBe("rubberBanding");
    runUntilIdle(scroller);
    expect(scroller.value).toBe(500);
  });

  it("animated jumps snap to the clamped target; catching stops motion", () => {
    const scroller = new MomentumScroller({ min: 0, max: 400 });
    scroller.jumpTo(900, true);
    runUntilIdle(scroller);
    expect(scroller.value).toBe(400);
    scroller.jumpTo(100);
    expect(scroller.value).toBe(100);
    scroller.beginDrag();
    scroller.release(1500);
    scroller.step(1 / 60);
    expect(scroller.isAnimating).toBe(true);
    scroller.beginDrag();
    expect(scroller.velocity).toBe(0);
    expect(scroller.phase).toBe("tracking");
    scroller.stop();
    expect(scroller.phase).toBe("idle");
  });

  it("is deterministic", () => {
    const run = () => {
      const s = new MomentumScroller({ min: 0, max: 700 }, 200);
      s.beginDrag();
      s.dragBy(30);
      s.dragBy(40);
      s.release(2800);
      const values: number[] = [];
      for (let i = 0; i < 120; i++) values.push(s.step(1 / 60));
      return values;
    };
    expect(run()).toEqual(run());
  });
});
