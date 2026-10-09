/**
 * The display's refresh rate, read from the frames the page gets: the frame loop runs as fast as
 * the display allows, so the fastest frames that keep coming show its rate (120 on a ProMotion Mac,
 * 60 on most displays). The HUD judges smoothness against it.
 */

export interface DisplayRate {
  /** A frame started at `now` (the scheduler's timestamp, in ms). */
  tick(now: number): void;
  /** The next frame doesn't follow the last one (the loop rested or paused): its gap isn't a frame. */
  reset(): void;
  /** The rate in Hz, or 0 until enough frames were seen. */
  hz(): number;
}

/** Rates displays run at. A measured rate within 5% of one reads as that rate. */
const COMMON_RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];
const WINDOW = 600;
const MIN_GAPS = 10;
/** A gap this long isn't one frame: the tab was hidden or the loop stalled. */
const MAX_GAP_MS = 100;

export function createDisplayRate(): DisplayRate {
  const gaps: number[] = [];
  let next = 0;
  let last: number | null = null;
  let cached: number | null = null;
  return {
    tick(now) {
      const gap = last === null ? 0 : now - last;
      last = now;
      if (!(gap > 0) || gap > MAX_GAP_MS) return;
      gaps[next] = gap;
      next = (next + 1) % WINDOW;
      cached = null;
    },
    reset() {
      last = null;
    },
    hz() {
      if (cached !== null) return cached;
      if (gaps.length < MIN_GAPS) return 0;
      // The fastest frames that keep coming, not the single fastest: one in ten, so an early
      // callback after a long frame doesn't count, and a loop that drops half its frames still shows the display.
      const sorted = [...gaps].sort((a, b) => a - b);
      const rate = 1000 / sorted[Math.floor(sorted.length / 10)]!;
      const common = COMMON_RATES.find((r) => Math.abs(rate - r) <= r * 0.05);
      return (cached = common ?? Math.round(rate));
    },
  };
}
