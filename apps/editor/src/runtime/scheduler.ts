/** Frame scheduling for the runtime host: requestAnimationFrame in the app, a manual clock in tests. */

export interface FrameScheduler {
  /** Call `cb` on the next frame with a timestamp in ms. */
  request(cb: (now: number) => void): number;
  cancel(handle: number): void;
  /** Current time in ms on the same clock as `request` timestamps. */
  now(): number;
}

const perfNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** requestAnimationFrame when available, else a 60 Hz timer. */
export function createAnimationFrameScheduler(): FrameScheduler {
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : undefined;
  const caf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : undefined;
  if (raf && caf) return { request: (cb) => raf(cb), cancel: (h) => caf(h), now: perfNow };
  return {
    request: (cb) => setTimeout(() => cb(perfNow()), 1000 / 60) as unknown as number,
    cancel: (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>),
    now: perfNow,
  };
}

export interface ManualScheduler extends FrameScheduler {
  /** Callbacks waiting for the next frame. */
  readonly pending: number;
  /** Advance the clock by `ms` (default one 60 Hz frame) and run the frame's callbacks. */
  frame(ms?: number): void;
  /** Run `count` frames. */
  frames(count: number, ms?: number): void;
}

/** A scheduler driven by hand: nothing runs until `frame()`. */
export function createManualScheduler(start = 0): ManualScheduler {
  let time = start;
  let counter = 0;
  let queue = new Map<number, (now: number) => void>();
  const scheduler: ManualScheduler = {
    request(cb) {
      const handle = ++counter;
      queue.set(handle, cb);
      return handle;
    },
    cancel(handle) {
      queue.delete(handle);
    },
    now: () => time,
    get pending() {
      return queue.size;
    },
    frame(ms = 1000 / 60) {
      time += ms;
      const run = queue;
      queue = new Map();
      for (const cb of run.values()) cb(time);
    },
    frames(count, ms) {
      for (let i = 0; i < count; i++) scheduler.frame(ms);
    },
  };
  return scheduler;
}
