/**
 * The display's refresh rate (120 on a ProMotion Mac, 60 on most displays), which the HUD judges
 * smoothness against. It can't be read from the prototype's own frames: a prototype too heavy for
 * the display gets its frames late (every other refresh on a fixed-rate display), and their steady
 * gaps look like a slower display. So the rate is measured apart from the prototype's work, by a
 * probe of empty frames each time the frame loop stops asking for its own (at rest, or paused).
 *
 * Both read frames the same way: twelve in a row that came evenly are a rate the display can run
 * at. A busy page and a variable-rate display under load give uneven frames, which say nothing.
 * From a probe that rate is the display's. From the loop's frames it is only a floor: until the
 * next probe it can raise the rate, never lower it. So a prototype that has never rested or paused
 * is judged against the fastest its frames have come evenly, and never against less than 60.
 */

import type { FrameScheduler } from "./scheduler.ts";

export interface DisplayRate {
  /** A frame of the loop started at `now` (the scheduler's timestamp, in ms). */
  tick(now: number): void;
  /** The next frame doesn't follow the last one (the loop rested or paused): its gap isn't a frame. */
  reset(): void;
  /** Time empty frames until the rate shows. The loop has stopped asking for frames, so nothing of the prototype's runs on them. */
  probe(): void;
  /** Stop a probe: the loop is about to run frames again. */
  stopProbe(): void;
  /** The rate in Hz (60 at least), or 0 until a probe ended or the loop's frames came evenly. */
  hz(): number;
}

/** Rates displays run at. A measured rate within 5% of one reads as that rate. */
const COMMON_RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];
/** Smoothness is never judged against less than this: a slower reading is taken for a busy or throttled page. */
const MIN_RATE = 60;
/** Frames in a row that came evenly are a rate: this many gaps... */
const EVEN_GAPS = 12;
/** ...each this close to the first of them. */
const EVEN_WITHIN = 0.15;
/** A probe that hasn't found them after this many frames gives up, and the rate stays as it was. */
const MAX_PROBE_FRAMES = 120;
/** A gap this long isn't one frame: the tab was hidden or the page stalled. */
const MAX_GAP_MS = 100;

/** Frame times in, and the rate of each run of even frames out (0 otherwise). */
function createEvenFrames() {
  const run: number[] = [];
  let last: number | null = null;
  return {
    /** The next frame doesn't follow the last one. The run goes on: its gaps were frames. */
    skip() {
      last = null;
    },
    clear() {
      last = null;
      run.length = 0;
    },
    frame(now: number): number {
      const gap = last === null ? null : now - last;
      last = now;
      if (gap === null) return 0;
      const isFrame = gap > 0 && gap <= MAX_GAP_MS;
      if (!isFrame || (run.length > 0 && Math.abs(gap - run[0]!) > run[0]! * EVEN_WITHIN)) run.length = 0;
      if (isFrame) run.push(gap);
      if (run.length < EVEN_GAPS) return 0;
      const rate = 1000 / (run.reduce((a, b) => a + b, 0) / run.length);
      run.length = 0;
      return COMMON_RATES.find((r) => Math.abs(rate - r) <= r * 0.05) ?? Math.round(rate);
    },
  };
}

/** `frames` runs the probe's empty frames; `onMeasured` is called when a probe ends with a rate. */
export function createDisplayRate(frames: Pick<FrameScheduler, "request" | "cancel">, onMeasured?: () => void): DisplayRate {
  /** What the last finished probe measured, or 0. */
  let probed = 0;
  /** The fastest rate the loop's frames have shown since then, or 0. */
  let seen = 0;
  const loop = createEvenFrames();
  const empty = createEvenFrames();
  let handle: number | null = null;
  let probeFrames = 0;

  const probeFrame = (now: number) => {
    handle = null;
    const rate = empty.frame(now);
    if (rate > 0) {
      probed = rate;
      // What the loop showed before may have been another display.
      seen = 0;
      loop.clear();
      onMeasured?.();
    } else if (++probeFrames <= MAX_PROBE_FRAMES) handle = frames.request(probeFrame);
  };

  return {
    tick(now) {
      seen = Math.max(seen, loop.frame(now));
    },
    reset() {
      loop.skip();
    },
    probe() {
      if (handle !== null) return;
      empty.clear();
      probeFrames = 0;
      handle = frames.request(probeFrame);
    },
    stopProbe() {
      if (handle === null) return;
      frames.cancel(handle);
      handle = null;
    },
    hz() {
      const known = Math.max(probed, seen);
      return known > 0 ? Math.max(MIN_RATE, known) : 0;
    },
  };
}
