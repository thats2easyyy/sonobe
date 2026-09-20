import type { ServerContext } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isHostError } from "./host.ts";
import { callSignal, ToolCancelledError, toolWork } from "./progress.ts";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A tools/call context with a progress token (or none), a cancel switch and a notify spy. */
function fakeContext(token: string | number | null = "tok") {
  const controller = new AbortController();
  const sent: { progress: number; message: string }[] = [];
  const notify = vi.fn(async (n: { params: { progress: number; message: string; progressToken: unknown } }) => {
    expect(n.params.progressToken).toBe(token);
    sent.push({ progress: n.params.progress, message: n.params.message });
  });
  const ctx = { mcpReq: { id: 7, signal: controller.signal, _meta: token === null ? {} : { progressToken: token }, notify } } as unknown as ServerContext;
  return { ctx, controller, sent, notify, messages: () => sent.map((s) => s.message) };
}

const never = <T>() => new Promise<T>(() => undefined);

describe("toolWork", () => {
  it("sends nothing without a progress token", async () => {
    const f = fakeContext(null);
    const work = toolWork(f.ctx);
    expect(work.reporting).toBe(false);
    work.progress("Loading");
    await work.step("Capturing", async (c) => c.progress({ message: "Downloading images: 1 of 2" }), { deadlineMs: 60_000 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.notify).not.toHaveBeenCalled();
    work.dispose();
  });

  it("sends steps and stages at once, throttles count updates, and keeps progress increasing", async () => {
    const f = fakeContext();
    const work = toolWork(f.ctx);
    expect(work.reporting).toBe(true);
    const step = work.step("Loading http://localhost:3000", async (c) => {
      c.progress({ message: "Reading the page's layers" });
      c.progress({ message: "Downloading images: 1 of 3", progress: 1, total: 3 });
      c.progress({ message: "Downloading images: 2 of 3", progress: 2, total: 3 });
      c.progress({ message: "Downloading images: 3 of 3", progress: 3, total: 3 });
      await new Promise((r) => setTimeout(r, 1_000));
      return "captured";
    });
    // Messages without counts go out at once; the burst of counts within 250 ms collapses to its newest.
    expect(f.messages()).toEqual(["Loading http://localhost:3000", "Reading the page's layers"]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await step).toBe("captured");
    expect(f.messages()).toEqual(["Loading http://localhost:3000", "Reading the page's layers", "Downloading images: 3 of 3"]);
    await work.step("Storing 3 image files", async () => undefined);
    expect(f.messages().at(-1)).toBe("Storing 3 image files");
    const values = f.sent.map((s) => s.progress);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
    work.dispose();
  });

  it("repeats the latest message as a heartbeat, and goes quiet at the step's deadline", async () => {
    const f = fakeContext();
    const work = toolWork(f.ctx, { heartbeatMs: 10_000 });
    const step = work.step("Loading the page", (c) => {
      c.progress({ message: "Reading the page's layers" });
      return never();
    }, { deadlineMs: 35_000 });
    const caught = step.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(34_000);
    expect(f.messages()).toEqual(["Loading the page", "Reading the page's layers", "Reading the page's layers (10 s)", "Reading the page's layers (20 s)", "Reading the page's layers (30 s)"]);
    await vi.advanceTimersByTimeAsync(1_000);
    const err = await caught;
    expect(isHostError(err) && err.code).toBe("timeout");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.sent).toHaveLength(5);
    work.dispose();
  });

  it("uses the step's own timeout error, and aborts the host's control signal", async () => {
    const f = fakeContext();
    const work = toolWork(f.ctx);
    let hostSignal: AbortSignal | undefined;
    const step = work.step("Capturing", (c) => {
      hostSignal = c.signal;
      return never();
    }, { deadlineMs: 5_000, onTimeout: () => new Error("the capture took too long") });
    const caught = step.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(((await caught) as Error).message).toBe("the capture took too long");
    expect(hostSignal?.aborted).toBe(true);
    work.dispose();
  });

  it("rejects promptly on cancel even when the host never settles", async () => {
    const f = fakeContext();
    const work = toolWork(f.ctx);
    let hostSignal: AbortSignal | undefined;
    const step = work.step("Capturing", (c) => {
      hostSignal = c.signal;
      return never();
    }, { deadlineMs: 120_000 });
    const caught = step.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    f.controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    const err = await caught;
    expect(err).toBeInstanceOf(ToolCancelledError);
    expect((err as ToolCancelledError).code).toBe("cancelled");
    expect(hostSignal?.aborted).toBe(true);
    expect(() => work.throwIfCancelled()).toThrow(ToolCancelledError);
    await expect(work.step("Next", async () => 1)).rejects.toBeInstanceOf(ToolCancelledError);
    work.dispose();
  });

  it("waits for a step that can't be taken back, with its control signal aborted", async () => {
    const f = fakeContext();
    const work = toolWork(f.ctx);
    let hostSignal: AbortSignal | undefined;
    const step = work.step("Saving", async (c) => {
      hostSignal = c.signal;
      await new Promise((r) => setTimeout(r, 2_000));
      return "saved";
    }, { deadlineMs: 130_000, finishOnCancel: true });
    f.controller.abort();
    work.progress("After the cancel");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await step).toBe("saved");
    expect(hostSignal?.aborted).toBe(true);
    // Nothing is reported for a cancelled call.
    expect(f.messages()).toEqual(["Saving"]);
    work.dispose();
  });

  it("checkpoint yields after 100 ms of work, then throws once cancelled", async () => {
    let clock = 0;
    const f = fakeContext();
    const work = toolWork(f.ctx, { now: () => clock });
    await work.checkpoint();
    clock = 150;
    let yielded = false;
    const pending = work.checkpoint("Stepping 7200 frames").then(() => (yielded = true));
    expect(yielded).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(yielded).toBe(true);
    expect(f.messages()).toEqual(["Stepping 7200 frames"]);
    f.controller.abort();
    await expect(work.checkpoint()).rejects.toBeInstanceOf(ToolCancelledError);
    work.dispose();
  });

  it("drops progress after dispose, including a host's late reports", async () => {
    const f = fakeContext();
    const work = toolWork(f.ctx);
    let late: ((m: string) => void) | undefined;
    await work.step("Capturing", async (c) => {
      late = (message) => c.progress({ message });
    });
    work.dispose();
    late?.("Downloading images: 9 of 9");
    work.progress("After the result");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.messages()).toEqual(["Capturing"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("callSignal", () => {
  it("is the SDK's signal when the transport adds nothing", () => {
    const f = fakeContext();
    expect(callSignal(f.ctx, undefined).signal).toBe(f.ctx.mcpReq.signal);
  });

  it("also aborts on the connection and on a cancel routed by request id", () => {
    for (const via of ["connection", "routed"] as const) {
      const f = fakeContext();
      const connection = new AbortController();
      const tracked: AbortController[] = [];
      const untrack = vi.fn();
      const call = callSignal(f.ctx, {
        signal: connection.signal,
        track: (id, controller) => {
          expect(id).toBe(7);
          tracked.push(controller);
          return untrack;
        },
      });
      expect(call.signal.aborted).toBe(false);
      if (via === "connection") connection.abort();
      else tracked[0]!.abort();
      expect(call.signal.aborted).toBe(true);
      call.release();
      expect(untrack).toHaveBeenCalledOnce();
    }
  });
});
