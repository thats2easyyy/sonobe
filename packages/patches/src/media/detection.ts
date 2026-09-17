/**
 * Shared machinery for the detector patches (Face, Hand, QR Code): detection passes that start on
 * new frames, superseded results, tracking IDs by intersection over union, and value sanitizing.
 */

import type { LayerRef } from "@sonobe/core";
import type { PatchContext } from "@sonobe/engine";
import { finiteOr } from "../infra/index.ts";
import { describeError } from "./shared.ts";

export type Box = [number, number, number, number];
export type Point = [number, number];

export interface PassResult {
  ok: boolean;
  items: readonly unknown[];
  message: string;
}

export interface DetectionState<T> {
  results: T[];
  requestId: number;
  pending: { id: number; result: PassResult | null } | null;
  lastRun: number;
  lastFrame: number | null;
  nextId: number;
  layerKey: string;
}

export function createDetectionState<T>(): DetectionState<T> {
  return { results: [], requestId: 0, pending: null, lastRun: Number.NEGATIVE_INFINITY, lastFrame: null, nextId: 0, layerKey: "" };
}

/** Drop the in-flight pass and every result. */
export function clearDetection<T>(state: DetectionState<T>): void {
  state.requestId++;
  state.pending = null;
  state.results = [];
  state.lastFrame = null;
}

/** The finished result of the current pass, if one arrived since the last frame. */
export function takePass<T>(state: DetectionState<T>): PassResult | undefined {
  const request = state.pending;
  if (!request?.result || request.id !== state.requestId) return undefined;
  state.pending = null;
  return request.result;
}

/** The layer's current frame id from the host, or undefined when it has no frames. */
export function frameIdOf(ctx: PatchContext, layer: LayerRef): number | undefined {
  try {
    const id = ctx.services.platform.media?.frameId?.(layer);
    return typeof id === "number" ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Start a pass when none is in flight, the layer shows a new frame, and the quality's cadence
 * allows it (Low: at most 10 passes per second).
 */
export function maybeStartPass<T>(ctx: PatchContext, state: DetectionState<T>, layer: LayerRef, high: boolean, detect: () => Promise<readonly unknown[]>): void {
  if (state.pending !== null) return;
  const frame = frameIdOf(ctx, layer);
  if (frame === undefined || frame === state.lastFrame || ctx.time - state.lastRun < (high ? 0 : 0.1)) return;
  const request: { id: number; result: PassResult | null } = { id: ++state.requestId, result: null };
  state.pending = request;
  state.lastRun = ctx.time;
  state.lastFrame = frame;
  let promise: Promise<readonly unknown[]>;
  try {
    promise = Promise.resolve(detect());
  } catch (error) {
    promise = Promise.reject(error);
  }
  promise.then(
    (items) => {
      request.result = { ok: true, items: Array.isArray(items) ? items : [], message: "" };
    },
    (error: unknown) => {
      request.result = { ok: false, items: [], message: describeError(error) };
    },
  );
}

/** A finite point, or [0, 0]. */
export function finitePoint(value: unknown): Point {
  const v = Array.isArray(value) ? value : [];
  return [finiteOr(v[0], 0), finiteOr(v[1], 0)];
}

/** A box with finite components and non-negative size, or undefined. */
export function finiteBox(value: unknown): Box | undefined {
  if (!Array.isArray(value) || value.length < 4) return undefined;
  const [x, y, w, h] = value;
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  return [x as number, y as number, Math.max(0, w as number), Math.max(0, h as number)];
}

export function boxArea(box: Box): number {
  return box[2] * box[3];
}

/** Intersection over union of two [x, y, w, h] boxes (0 when either is empty). */
export function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = boxArea(a) + boxArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

/** Sort by box area, largest first (stable). */
export function largestFirst<T extends { box: Box }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => boxArea(b.box) - boxArea(a.box));
}

/**
 * Give each new result an id: greedily, largest first, match the unmatched previous result with the
 * highest IoU of at least 0.3 and keep its id; others take `state.nextId++`.
 */
export function assignTrackingIds<T extends { box: Box }>(state: { nextId: number }, previous: readonly (T & { id: number })[], results: readonly T[]): (T & { id: number })[] {
  const used = new Set<number>();
  return results.map((item) => {
    let best = -1;
    let bestScore = 0.3;
    previous.forEach((old, i) => {
      if (used.has(i)) return;
      const score = iou(item.box, old.box);
      if (score >= bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best >= 0) {
      used.add(best);
      return { ...item, id: previous[best]!.id };
    }
    return { ...item, id: state.nextId++ };
  });
}
