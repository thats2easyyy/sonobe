/** Rolling frames-per-second over the last N frame timestamps. */

export interface FpsMeter {
  tick(now: number): void;
  fps(): number;
  reset(): void;
}

export function createFpsMeter(samples = 30): FpsMeter {
  const size = Math.max(2, samples);
  const times: number[] = [];
  return {
    tick(now) {
      times.push(now);
      if (times.length > size) times.shift();
    },
    fps() {
      if (times.length < 2) return 0;
      const span = times[times.length - 1]! - times[0]!;
      return span > 0 ? ((times.length - 1) * 1000) / span : 0;
    },
    reset() {
      times.length = 0;
    },
  };
}
