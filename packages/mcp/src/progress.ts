/**
 * Long tool calls: progress notifications and cancellation (ARCHITECTURE §10, "Long calls").
 *
 * Every tool handler gets a ToolWork as its third argument. `work.signal` aborts when the client
 * cancels the call, disconnects, or the transport closes; `work.step` reports a step, hands the host
 * a control ({ signal, progress }) and re-sends the step's message as a heartbeat, but only until the
 * step's deadline, so a hung step goes quiet instead of looking alive. Nothing is sent without a
 * progressToken, after a cancel, or after the call ends. Browser-safe.
 */

import type { ServerContext } from "@modelcontextprotocol/server";
import { HostError, type HostCallControl, type ProgressStep } from "./host.ts";

/**
 * What a transport knows about a call beyond the SDK's context. Over stateless HTTP, a disconnect and a
 * notifications/cancelled (a POST of its own, answered by a fresh server) don't reliably reach
 * ctx.mcpReq.signal, so createHttpHandler supplies them here (stdio needs none).
 */
export interface CallScope {
  /** Aborts when the client's connection for this call closes before the response is finished. */
  signal?: AbortSignal;
  /** Let a notifications/cancelled naming `requestId` abort `controller`. Returns the unregister function. */
  track?(requestId: string | number, controller: AbortController): () => void;
  /** The calling session's `sonobe-client` header (clients.ts), when the relay sent one. */
  clientId?: string;
}

/** The call's one cancellation signal: the SDK's own, the connection's, and cancels routed by request id. */
export function callSignal(ctx: ServerContext, scope: CallScope | undefined): { signal: AbortSignal; release(): void } {
  if (!scope?.signal && !scope?.track) return { signal: ctx.mcpReq.signal, release: () => undefined };
  const routed = new AbortController();
  const release = scope.track?.(ctx.mcpReq.id, routed) ?? (() => undefined);
  return { signal: AbortSignal.any([ctx.mcpReq.signal, routed.signal, ...(scope.signal ? [scope.signal] : [])]), release };
}

/** A call that stopped because it was cancelled, before it changed anything. */
export class ToolCancelledError extends HostError {
  constructor(message = "The call was cancelled.") {
    super("cancelled", message);
  }
}

export interface StepOptions {
  /** Give up after this long. The heartbeat only runs while a deadline bounds the step. */
  deadlineMs?: number;
  /** The error for the deadline (default: HostError "timeout" naming the step). */
  onTimeout?(): Error;
  /**
   * For host calls that can't be taken back (a save): after a cancel, keep waiting for fn instead of
   * rejecting, so the result never claims nothing changed. control.signal still aborts.
   */
  finishOnCancel?: boolean;
}

export interface ToolWork {
  /** Aborts when the client cancels the call, disconnects, or the transport closes. */
  readonly signal: AbortSignal;
  /** Whether the client asked for progress (sent a progressToken). */
  readonly reporting: boolean;
  /** Report where the call is. A no-op without a progressToken; count updates are throttled. */
  progress(step: ProgressStep | string): void;
  /** Throw ToolCancelledError once the call is cancelled. */
  throwIfCancelled(): void;
  /**
   * Run one step: report `message`, then run `fn` with a control whose signal aborts when the call is
   * cancelled or the deadline passes. Rejects as soon as either happens, even when fn never settles.
   */
  step<T>(message: string, fn: (control: Required<HostCallControl>) => Promise<T>, options?: StepOptions): Promise<T>;
  /** For long synchronous loops: yield to the event loop when 100 ms passed since the last yield, then throwIfCancelled. */
  checkpoint(step?: ProgressStep | string): Promise<void>;
  /** Stop the timers and drop later progress (the tool wrapper calls it when the call ends). */
  dispose(): void;
}

export interface ToolWorkOptions {
  /** The call's cancellation signal (default: the SDK's ctx.mcpReq.signal). */
  signal?: AbortSignal;
  /** Heartbeat interval while a step runs. Default 10 s. */
  heartbeatMs?: number;
  /** Shortest gap before a count update (7 of 28) follows another notification. Default 250 ms. */
  minIntervalMs?: number;
  now?(): number;
}

const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;

/** The ToolWork for one tools/call. */
export function toolWork(ctx: ServerContext, options: ToolWorkOptions = {}): ToolWork {
  const signal = options.signal ?? ctx.mcpReq.signal;
  const token = ctx.mcpReq._meta?.progressToken;
  const heartbeatMs = options.heartbeatMs ?? 10_000;
  const minIntervalMs = options.minIntervalMs ?? 250;
  const now = options.now ?? Date.now;
  let sequence = 0;
  let lastSentAt = -Infinity;
  let pending: ProgressStep | undefined;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  let lastYield = now();
  let disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const send = (step: ProgressStep) => {
    if (disposed || token === undefined) return;
    lastSentAt = now();
    pending = undefined;
    // progress must grow with every notification, and a call's steps have no common total, so it counts
    // notifications; a step's own counts are in its message.
    void ctx.mcpReq
      .notify({ method: "notifications/progress", params: { progressToken: token, progress: ++sequence, message: step.message } })
      .catch(() => undefined);
  };

  /**
   * Send now. Count updates (a step with `progress`, like 7 of 28 images) within minIntervalMs of the
   * last notification wait until the interval has passed, and only the newest is sent.
   */
  const report = (step: ProgressStep, immediate: boolean) => {
    // A cancelled call gets no more progress, even while a step that can't be taken back finishes.
    if (disposed || token === undefined || signal.aborted) return;
    if (immediate || step.progress === undefined || now() - lastSentAt >= minIntervalMs) {
      clearTimeout(trailing);
      trailing = undefined;
      send(step);
      return;
    }
    pending = step;
    trailing ??= setTimeout(() => {
      trailing = undefined;
      if (pending && !signal.aborted) send(pending);
    }, Math.max(0, minIntervalMs - (now() - lastSentAt)));
  };

  const asStep = (step: ProgressStep | string): ProgressStep => (typeof step === "string" ? { message: step } : step);

  const throwIfCancelled = () => {
    if (signal.aborted) throw new ToolCancelledError();
  };

  return {
    signal,
    reporting: token !== undefined,
    progress: (step) => report(asStep(step), false),
    throwIfCancelled,

    step<T>(message: string, fn: (control: Required<HostCallControl>) => Promise<T>, stepOptions: StepOptions = {}): Promise<T> {
      if (signal.aborted && !stepOptions.finishOnCancel) return Promise.reject(new ToolCancelledError());
      report({ message }, true);
      const started = now();
      let latest = message;
      let active = true;
      const child = new AbortController();
      return new Promise<T>((resolve, reject) => {
        const local = new Set<ReturnType<typeof setTimeout>>();
        const later = (ms: number, run: () => void) => {
          const t = setTimeout(() => {
            local.delete(t);
            timers.delete(t);
            run();
          }, ms);
          local.add(t);
          timers.add(t);
        };
        const settle = (finish: () => void) => {
          if (!active) return;
          active = false;
          for (const t of local) {
            clearTimeout(t);
            timers.delete(t);
          }
          signal.removeEventListener("abort", onCancel);
          finish();
        };
        const fail = (err: Error) => {
          child.abort(err);
          settle(() => reject(err));
        };
        const onCancel = () => {
          if (stepOptions.finishOnCancel) child.abort(new ToolCancelledError());
          else fail(new ToolCancelledError());
        };
        if (signal.aborted) onCancel();
        else signal.addEventListener("abort", onCancel, { once: true });
        const deadlineMs = stepOptions.deadlineMs;
        if (deadlineMs !== undefined) {
          later(deadlineMs, () => fail(stepOptions.onTimeout?.() ?? new HostError("timeout", `${message} didn't finish within ${seconds(deadlineMs)}.`, { hint: "Try again. If it keeps happening, check that the Sonobe app is responding." })));
          // Heartbeats say the step is alive; they end with the step, at its deadline at the latest.
          const beat = () => {
            if (now() - started + heartbeatMs > deadlineMs) return;
            later(heartbeatMs, () => {
              report({ message: `${latest} (${seconds(now() - started)})` }, true);
              beat();
            });
          };
          if (token !== undefined) beat();
        }
        const control: Required<HostCallControl> = {
          signal: child.signal,
          progress: (step) => {
            if (!active) return;
            latest = step.message;
            report(step, false);
          },
        };
        let work: Promise<T>;
        try {
          work = fn(control);
        } catch (err) {
          work = Promise.reject(err);
        }
        // A step that gave up may see fn reject later; that's expected, not unhandled.
        work.catch(() => undefined);
        work.then(
          (value) => settle(() => resolve(value)),
          (err: unknown) => settle(() => reject(err)),
        );
      });
    },

    async checkpoint(step) {
      if (step !== undefined) report(asStep(step), false);
      if (now() - lastYield >= 100) {
        await new Promise((r) => setTimeout(r, 0));
        lastYield = now();
      }
      throwIfCancelled();
    },

    dispose() {
      disposed = true;
      clearTimeout(trailing);
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
}
