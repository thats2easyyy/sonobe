/**
 * One deadline over a whole design capture, shared by the desktop's hidden window and Playwright:
 * every await in a capture goes through `step`, which races it against the caller's cancel, the
 * capture's deadline and an optional budget of its own. The deadline's error names the stage that ran
 * out of time, and work a step abandons can't raise unhandled rejections later. Browser-safe.
 */

export type CaptureStage = "starting" | "loading" | "color-scheme" | "walking" | "symbols" | "images" | "screenshot";

/** What a capture is doing now, for progress reports. */
export interface CaptureProgress {
  stage: CaptureStage;
  message: string;
  /** Items done so far in this stage (with total: 7 of 28 images). */
  done?: number;
  total?: number;
}

/** How a caller follows and stops a capture. */
export interface CaptureControl {
  /** Cancels the capture: the host frees its browser resources and rejects with CaptureCancelledError. */
  signal?: AbortSignal;
  onProgress?(progress: CaptureProgress): void;
}

/** The whole capture's deadline, not counting waitMs (which is added on top). */
export const CAPTURE_TIMEOUT_MS = 90_000;

/** Longest single steps. A step the deadline would cut short gets the deadline's error instead. */
export const CAPTURE_BUDGETS = {
  launch: 30_000,
  load: 30_000,
  colorScheme: 5_000,
  /** Plus waitMs. */
  walk: 45_000,
  /** Drawing the page's SF Symbols, and putting the drawings in. */
  symbols: 20_000,
  screenshot: 15_000,
} as const;

/** Images still downloading this close to the deadline become placeholders. */
export const IMAGE_CUTOFF_MS = 5_000;

const STAGE_TEXT: Record<CaptureStage, string> = {
  starting: "starting",
  loading: "loading the page",
  "color-scheme": "switching the color scheme",
  walking: "reading the page's layers",
  symbols: "drawing SF Symbols",
  images: "downloading images",
  screenshot: "taking the page screenshot",
};

const STAGE_HINT: Record<CaptureStage, string> = {
  starting: "Try the import again. If it keeps happening, restart Sonobe.",
  loading: "Check that the page opens quickly in a browser. A dev server that's still compiling can be slow, so open the page once first.",
  "color-scheme": "Import without colorScheme, or set the color scheme in the page itself.",
  walking: "The page may be busy or stuck in a loop. Try waitFor with a selector that appears once the screen has loaded, or import one part with selector.",
  symbols: "Try the import again. If it keeps stopping here, use inline <svg> icons instead of data-sf-symbol placeholders.",
  images: "Reference fewer or smaller images, or images on a faster host.",
  screenshot: "Import without screenshot, then compare with get_screenshot.",
};

/** The capture ran past its deadline. */
export class CaptureTimeoutError extends Error {
  readonly code = "capture_timeout";
  readonly stage: CaptureStage;
  readonly hint: string;
  constructor(stage: CaptureStage, ms: number) {
    super(`The capture didn't finish within ${Math.round(ms / 1000)} seconds. It stopped while ${STAGE_TEXT[stage]}.`);
    this.name = "CaptureTimeoutError";
    this.stage = stage;
    this.hint = STAGE_HINT[stage];
  }
}

/** The caller cancelled the capture. */
export class CaptureCancelledError extends Error {
  readonly code = "cancelled";
  readonly hint = "Nothing was imported. Import again when you're ready.";
  constructor(message = "The capture was cancelled.") {
    super(message);
    this.name = "CaptureCancelledError";
  }
}

/** One step ran past its own budget (the caller turns it into its own teaching error). */
export class StepTimeoutError extends Error {
  readonly budgetMs: number;
  constructor(budgetMs: number) {
    super(`The step didn't finish within ${Math.round(budgetMs / 1000)} seconds.`);
    this.name = "StepTimeoutError";
    this.budgetMs = budgetMs;
  }
}

export interface CaptureRunOptions extends CaptureControl {
  /** The whole capture, not counting waitMs. Default CAPTURE_TIMEOUT_MS. */
  timeoutMs?: number;
  waitMs?: number;
  /** Clock (tests). Default Date.now. */
  now?(): number;
}

export interface CaptureRun {
  /** Aborts on the caller's cancel (reason: CaptureCancelledError) or at the deadline (CaptureTimeoutError). */
  readonly signal: AbortSignal;
  /** When the whole capture must be done, on the run's clock. */
  readonly deadline: number;
  /** The stage the last report named. */
  readonly stage: CaptureStage;
  /**
   * Race `work` against the run's signal and, optionally, a budget of its own. Rejects with the run's
   * abort reason, or StepTimeoutError when the budget runs out first.
   */
  step<T>(work: Promise<T>, budgetMs?: number): Promise<T>;
  /** Enter a stage (it names the stage in a timeout) and tell the caller. */
  report(progress: CaptureProgress): void;
  /** Throw the run's abort reason when it was cancelled or timed out. */
  throwIfAborted(): void;
  /** Clear the deadline timer and stop listening to the caller's signal. */
  dispose(): void;
}

export function createCaptureRun(options: CaptureRunOptions = {}): CaptureRun {
  const now = options.now ?? Date.now;
  const total = Math.max(0, options.timeoutMs ?? CAPTURE_TIMEOUT_MS) + Math.max(0, options.waitMs ?? 0);
  const deadline = now() + total;
  const controller = new AbortController();
  let stage: CaptureStage = "starting";
  const timer = setTimeout(() => controller.abort(new CaptureTimeoutError(stage, total)), total);
  const onCallerAbort = () => controller.abort(new CaptureCancelledError());
  const caller = options.signal;
  if (caller?.aborted) onCallerAbort();
  else caller?.addEventListener("abort", onCallerAbort, { once: true });
  const signal = controller.signal;

  return {
    signal,
    deadline,
    get stage() {
      return stage;
    },
    step<T>(work: Promise<T>, budgetMs?: number): Promise<T> {
      // Work a step gives up on may still reject later; that's expected, not unhandled.
      work.catch(() => undefined);
      if (signal.aborted) return Promise.reject(signal.reason);
      // A budget the deadline cuts short is the deadline's to enforce, so its error names the whole capture.
      const budget = budgetMs !== undefined && budgetMs < deadline - now() ? budgetMs : undefined;
      return new Promise<T>((resolve, reject) => {
        const budgetTimer = budget !== undefined ? setTimeout(() => settle(() => reject(new StepTimeoutError(budget))), budget) : undefined;
        const onAbort = () => settle(() => reject(signal.reason));
        const settle = (finish: () => void) => {
          clearTimeout(budgetTimer);
          signal.removeEventListener("abort", onAbort);
          finish();
        };
        signal.addEventListener("abort", onAbort, { once: true });
        work.then(
          (value) => settle(() => resolve(value)),
          (err: unknown) => settle(() => reject(err)),
        );
      });
    },
    report(progress) {
      stage = progress.stage;
      if (signal.aborted) return;
      try {
        options.onProgress?.(progress);
      } catch {
        // A progress listener failing never breaks a capture.
      }
    },
    throwIfAborted() {
      if (signal.aborted) throw signal.reason;
    },
    dispose() {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
    },
  };
}
