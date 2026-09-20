import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureCancelledError, CaptureTimeoutError, createCaptureRun, StepTimeoutError } from "./run.ts";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const never = <T>() => new Promise<T>(() => undefined);

describe("createCaptureRun", () => {
  it("names the stage it was in when the deadline passes", async () => {
    const run = createCaptureRun({ timeoutMs: 10_000, waitMs: 2_000 });
    run.report({ stage: "walking", message: "Reading the page's layers" });
    const step = run.step(never());
    const caught = step.catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(12_000);
    const err = (await caught) as CaptureTimeoutError;
    expect(err).toBeInstanceOf(CaptureTimeoutError);
    expect(err.code).toBe("capture_timeout");
    expect(err.stage).toBe("walking");
    expect(err.message).toBe("The capture didn't finish within 12 seconds. It stopped while reading the page's layers.");
    expect(err.hint).toContain("waitFor");
    expect(run.signal.aborted).toBe(true);
    run.dispose();
  });

  it("turns the caller's abort into a cancel, before or during a step", async () => {
    const early = new AbortController();
    early.abort();
    const cancelledRun = createCaptureRun({ signal: early.signal });
    await expect(cancelledRun.step(Promise.resolve(1))).rejects.toBeInstanceOf(CaptureCancelledError);
    cancelledRun.dispose();

    const caller = new AbortController();
    const run = createCaptureRun({ signal: caller.signal });
    const step = run.step(never());
    caller.abort();
    const err = await step.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CaptureCancelledError);
    expect((err as CaptureCancelledError).code).toBe("cancelled");
    expect(() => run.throwIfAborted()).toThrow(CaptureCancelledError);
    run.dispose();
  });

  it("enforces a step's own budget, unless the deadline would end it first", async () => {
    const run = createCaptureRun({ timeoutMs: 10_000 });
    const budgeted = run.step(never(), 3_000).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await budgeted).toBeInstanceOf(StepTimeoutError);
    // 7 s are left: a 30 s budget can't finish in time, so the deadline's error (naming the stage) wins.
    run.report({ stage: "loading", message: "Loading" });
    const cut = run.step(never(), 30_000).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(7_000);
    const err = await cut;
    expect(err).toBeInstanceOf(CaptureTimeoutError);
    expect((err as CaptureTimeoutError).stage).toBe("loading");
    run.dispose();
  });

  it("passes results through and swallows late rejections of abandoned work", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const run = createCaptureRun({ timeoutMs: 5_000 });
      expect(await run.step(Promise.resolve("ok"))).toBe("ok");
      await expect(run.step(Promise.reject(new Error("boom")))).rejects.toThrow("boom");
      let rejectLate!: (err: Error) => void;
      const late = new Promise<never>((_, reject) => (rejectLate = reject));
      const step = run.step(late, 1_000).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await step).toBeInstanceOf(StepTimeoutError);
      rejectLate(new Error("too late"));
      await vi.advanceTimersByTimeAsync(10);
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
      run.dispose();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("reports progress, survives a failing listener, and clears its timers on dispose", async () => {
    const seen: string[] = [];
    const caller = new AbortController();
    const run = createCaptureRun({
      timeoutMs: 5_000,
      signal: caller.signal,
      onProgress: (p) => {
        seen.push(`${p.stage}: ${p.message}`);
        throw new Error("listener bug");
      },
    });
    run.report({ stage: "images", message: "Downloading images: 1 of 2", done: 1, total: 2 });
    expect(run.stage).toBe("images");
    expect(seen).toEqual(["images: Downloading images: 1 of 2"]);
    run.dispose();
    expect(vi.getTimerCount()).toBe(0);
    caller.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    // Disposed: neither the deadline nor the caller's abort reaches the run any more.
    expect(run.signal.aborted).toBe(false);
  });
});
