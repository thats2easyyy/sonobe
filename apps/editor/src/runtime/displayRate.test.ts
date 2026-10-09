import { describe, expect, it, vi } from "vitest";
import { smoothness } from "../panels/hud/perfModel.ts";
import { createDisplayRate } from "./displayRate.ts";
import { createManualScheduler } from "./scheduler.ts";

function setup() {
  const scheduler = createManualScheduler(1000);
  const measured = vi.fn();
  const rate = createDisplayRate(scheduler, measured);
  let now = 1000;
  return {
    scheduler,
    measured,
    rate,
    /** Empty frames with these gaps, while a probe runs. */
    empty(gaps: number[]) {
      for (const gap of gaps) scheduler.frame(gap);
    },
    /** Frames of the prototype's loop with these gaps. */
    loop(gaps: number[]) {
      rate.reset();
      rate.tick(now);
      for (const gap of gaps) rate.tick((now += gap));
    },
  };
}

const steady = (ms: number, n = 60) => Array.from({ length: n }, () => ms);

/** The rate a probe of steady empty frames reads. */
function probed(ms: number, n = 20) {
  const made = setup();
  made.rate.probe();
  made.empty(steady(ms, n));
  return made;
}

describe("display rate: a probe of empty frames", () => {
  it("reads the rate of steady frames, snapped to a rate displays run at", () => {
    expect(probed(1000 / 120).rate.hz()).toBe(120);
    expect(probed(16.67).rate.hz()).toBe(60);
    expect(probed(16.4).rate.hz()).toBe(60);
    expect(probed(1000 / 144).rate.hz()).toBe(144);
    expect(probed(1000 / 85).rate.hz()).toBe(85);
  });

  it("ends after twelve frames that came evenly, says so once, and asks for no more", () => {
    const { rate, scheduler, measured, empty } = setup();
    expect(rate.hz()).toBe(0);
    rate.probe();
    rate.probe();
    expect(scheduler.pending).toBe(1);
    // The first frame starts the clock; twelve gaps follow it.
    empty(steady(1000 / 120, 12));
    expect(rate.hz()).toBe(0);
    expect(scheduler.pending).toBe(1);
    empty(steady(1000 / 120, 1));
    expect(rate.hz()).toBe(120);
    expect(measured).toHaveBeenCalledTimes(1);
    expect(scheduler.pending).toBe(0);
  });

  it("waits out a busy page: uneven frames, a stall and a hidden tab don't count", () => {
    const { rate, empty } = setup();
    rate.probe();
    // The editor is busy: every other frame is late, then the tab is hidden for five seconds.
    empty([...Array.from({ length: 30 }, (_, i) => (i % 2 ? 1000 / 60 : 1000 / 120)), 5000]);
    expect(rate.hz()).toBe(0);
    empty(steady(1000 / 120, 13));
    expect(rate.hz()).toBe(120);
  });

  it("gives up on a page that stays busy, and keeps the rate it had", () => {
    const { rate, scheduler, measured, empty } = probed(1000 / 120);
    rate.probe();
    empty(Array.from({ length: 200 }, (_, i) => (i % 3 ? 1000 / 60 : 1000 / 120)));
    expect(scheduler.pending).toBe(0);
    expect(measured).toHaveBeenCalledTimes(1);
    expect(rate.hz()).toBe(120);
  });

  it("stops when the loop runs frames again", () => {
    const { rate, scheduler, empty } = setup();
    rate.probe();
    empty(steady(1000 / 120, 5));
    rate.stopProbe();
    expect(scheduler.pending).toBe(0);
    empty(steady(1000 / 120, 20));
    expect(rate.hz()).toBe(0);
    // The next probe starts over.
    rate.probe();
    empty(steady(16.67, 13));
    expect(rate.hz()).toBe(60);
  });

  it("never reads under 60: a slower reading is a throttled page", () => {
    expect(probed(1000 / 30).rate.hz()).toBe(60);
  });

  it("follows a window moved to a slower display at the next probe, not before", () => {
    const { rate, loop, empty } = probed(1000 / 120);
    loop(steady(1000 / 60, 700));
    expect(rate.hz()).toBe(120);
    rate.probe();
    empty(steady(1000 / 60, 13));
    expect(rate.hz()).toBe(60);
  });
});

describe("display rate: what the loop's own frames show", () => {
  it("a prototype stuck at half rate on a 120 Hz display isn't taken for a 60 Hz display", () => {
    const { rate, loop } = probed(1000 / 120);
    loop(steady(1000 / 60, 700));
    expect(rate.hz()).toBe(120);
    expect(smoothness(60, true, { displayHz: rate.hz() }).label).toBe("Some dropped frames");
    // Nor one that ran light for two seconds and heavy ever since, with no probe at all.
    const unprobed = setup();
    unprobed.loop([...steady(1000 / 120, 240), ...steady(1000 / 60, 720)]);
    expect(unprobed.rate.hz()).toBe(120);
  });

  it("a prototype steady at 30 or 20 fps is judged against 60 at least", () => {
    for (const fps of [30, 20]) {
      const { rate, loop } = setup();
      loop(steady(1000 / fps, 700));
      expect(rate.hz()).toBe(60);
      expect(smoothness(fps, true, { displayHz: rate.hz() }).label).not.toBe("Smooth");
    }
    // The same after a probe, and after fast frames at the start.
    const { rate, loop } = probed(1000 / 60);
    loop([...steady(1000 / 60, 120), ...steady(1000 / 30, 750)]);
    expect(rate.hz()).toBe(60);
    expect(smoothness(30, true, { displayHz: rate.hz() }).label).toBe("Some dropped frames");
  });

  it("reads 0 until the loop's frames came evenly twelve times or a probe ended", () => {
    const { rate, loop } = setup();
    loop(steady(16.67, 11));
    expect(rate.hz()).toBe(0);
    loop(steady(16.67, 1));
    expect(rate.hz()).toBe(60);
  });

  it("raises the rate when frames come faster than the probe read", () => {
    // A probe taken while the editor was busy at a steady half rate.
    const { rate, loop } = probed(1000 / 60);
    loop(steady(1000 / 120));
    expect(rate.hz()).toBe(120);
  });

  it("takes nothing from uneven frames: every other one dropped, or a variable-rate display under load", () => {
    const dropping = setup();
    dropping.loop(Array.from({ length: 120 }, (_, i) => (i % 2 ? 1000 / 60 : 1000 / 120)));
    expect(dropping.rate.hz()).toBe(0);
    // requestAnimationFrame times of a 10 ms frame on a ProMotion display: 94 fps on average, and
    // one gap in ten under 8 ms. The fastest of them isn't a rate (it read 130 Hz once).
    const { rate, loop } = probed(1000 / 120);
    loop(Array.from({ length: 600 }, (_, i) => [10.8, 7.7, 13.6, 10.7, 10.9, 12.9, 8.4, 10.8, 10.6, 11.8][i % 10]!));
    expect(rate.hz()).toBe(120);
    // Even at that pace, they are a floor under the probe's rate.
    loop(steady(10.7, 600));
    expect(rate.hz()).toBe(120);
  });

  it("isn't fooled by one early frame or by a long stall", () => {
    const early = setup();
    early.loop([...steady(16.67, 40), 3, ...steady(16.67, 40)]);
    expect(early.rate.hz()).toBe(60);
    const stalled = setup();
    stalled.loop([...steady(16.67, 20), 5000, ...steady(16.67, 20)]);
    expect(stalled.rate.hz()).toBe(60);
  });

  it("forgets the gap across a rest, and counts the frames on both sides of it", () => {
    const { rate } = setup();
    for (let i = 0; i <= 6; i++) rate.tick(i * (1000 / 120));
    rate.reset();
    // A minute later the loop wakes: the minute isn't a frame, and six more gaps finish the run.
    for (let i = 0; i <= 6; i++) rate.tick(60_000 + i * (1000 / 120));
    expect(rate.hz()).toBe(120);
  });
});
