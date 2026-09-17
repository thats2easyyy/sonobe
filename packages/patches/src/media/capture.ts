/**
 * Async request tracking for capture patches (Camera, Microphone) and per-instance evaluation: one
 * camera or microphone per patch, so looped inputs use item 0 and every index mirrors index 0.
 */

import type { AssetRef, Value } from "@sonobe/core";
import type { PatchContext, RuntimeServices } from "@sonobe/engine";
import { warnOnce } from "../infra/index.ts";
import { describeError, isAssetRef } from "./shared.ts";

export type RequestKind = "session" | "capture" | "recording";

export interface MediaRequest {
  kind: RequestKind;
  superseded: boolean;
  done: boolean;
  ok: boolean;
  value: AssetRef | null;
  message: string;
}

/** Start async work and record it; the promise's callback only stores the result. */
export function trackRequest(requests: MediaRequest[], kind: RequestKind, work: () => unknown): MediaRequest {
  const request: MediaRequest = { kind, superseded: false, done: false, ok: false, value: null, message: "" };
  requests.push(request);
  let promise: Promise<unknown>;
  try {
    promise = Promise.resolve(work());
  } catch (error) {
    promise = Promise.reject(error);
  }
  promise.then(
    (value) => {
      request.done = true;
      request.ok = true;
      request.value = isAssetRef(value) ? value : null;
    },
    (error: unknown) => {
      request.done = true;
      request.ok = false;
      request.message = describeError(error);
    },
  );
  return request;
}

/** Remove and return finished requests, in request order. */
export function takeFinished(requests: MediaRequest[]): MediaRequest[] {
  const finished: MediaRequest[] = [];
  let write = 0;
  for (const request of requests) {
    if (request.done) finished.push(request);
    else requests[write++] = request;
  }
  requests.length = write;
  return finished;
}

/** Mark pending requests of `kind` (or every kind) as superseded, so their results are dropped. */
export function supersede(requests: readonly MediaRequest[], kind?: RequestKind): void {
  for (const request of requests) if (kind === undefined || request.kind === kind) request.superseded = true;
}

export interface Emitter {
  output(key: string, value: Value): void;
  pulse(key: string): void;
}

interface Emission {
  frame: number;
  outputs: [string, Value][];
  pulses: string[];
}

const emissions = new WeakMap<RuntimeServices, Map<string, Emission>>();

/**
 * Run `run` once per patch instance: index 0 evaluates and records what it emits, and other loop
 * indices repeat it. A looped input warns once per restart.
 */
export function evaluateOncePerInstance(ctx: PatchContext, patchName: string, run: (emit: Emitter) => void): void {
  if (ctx.loopCount > 1) warnOnce(ctx, "loopedInputs", `${patchName}: inputs don't loop, so a looped input uses its first item.`);
  let map = emissions.get(ctx.services);
  if (!map) emissions.set(ctx.services, (map = new Map()));
  const key = `${ctx.componentPath}/${ctx.id}`;
  if (ctx.loopIndex === 0) {
    const emission: Emission = { frame: ctx.frame, outputs: [], pulses: [] };
    map.set(key, emission);
    run({
      output(k, v) {
        emission.outputs.push([k, v]);
        ctx.output(k, v);
      },
      pulse(k) {
        emission.pulses.push(k);
        ctx.pulse(k);
      },
    });
    return;
  }
  const emission = map.get(key);
  if (!emission || emission.frame !== ctx.frame) return;
  for (const [k, v] of emission.outputs) ctx.output(k, v);
  for (const k of emission.pulses) ctx.pulse(k);
}
