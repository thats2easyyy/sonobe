/**
 * Helpers shared by the device patches: finite vectors that warn once, preset lookup without a
 * fallback, per-instance stores for state one patch instance shares across its loop indices, and
 * promise and error plumbing.
 */

import { DEVICE_PRESETS } from "@sonobe/core";
import type { DevicePreset } from "@sonobe/core";
import type { PatchContext, RuntimeServices } from "@sonobe/engine";
import { warnOnce } from "../infra/index.ts";

/**
 * `value` as `length` finite numbers. Missing components read 0; non-finite ones read 0 and log
 * `message` once per restart under `key`.
 */
export function finiteVector(ctx: PatchContext, value: unknown, length: number, key: string, message: string): number[] {
  const out = new Array<number>(length).fill(0);
  if (!Array.isArray(value)) return out;
  let bad = false;
  for (let i = 0; i < length; i++) {
    const v = value[i];
    if (typeof v === "number" && Number.isFinite(v)) out[i] = v === 0 ? 0 : v;
    else if (v !== undefined) bad = true;
  }
  if (bad) warnOnce(ctx, key, message);
  return out;
}

/** The preset with this id, or undefined (core's getDevicePreset falls back to the first preset). */
export function findPreset(id: unknown): DevicePreset | undefined {
  return typeof id === "string" ? DEVICE_PRESETS.find((p) => p.id === id) : undefined;
}

/** A device's physical rotation in degrees counterclockwise, when the host reports one. */
export function orientationAngleOf(device: { orientationAngle?: number }): number | undefined {
  const angle = device.orientationAngle;
  return typeof angle === "number" && Number.isFinite(angle) ? angle : undefined;
}

interface StoreEntry<T> {
  value: T;
  frame: number;
  restartCount: number | undefined;
}

const stores = new WeakMap<RuntimeServices, Map<string, StoreEntry<unknown>>>();

/** Key of a patch instance: component path plus patch id (loop indices share it). */
export function instanceKey(ctx: Pick<PatchContext, "componentPath" | "id">): string {
  return `${ctx.componentPath}/${ctx.id}`;
}

/** The runtime's restart generation, or undefined for hosts that don't count restarts. */
export function restartGeneration(services: RuntimeServices): number | undefined {
  const count = (services as { restartCount?: unknown }).restartCount;
  return typeof count === "number" ? count : undefined;
}

/**
 * State shared by every loop index of one patch instance, created on first use and again after
 * every restart (`services.restartCount` changed, or the frame counter went backwards).
 */
export function instanceStore<T>(ctx: Pick<PatchContext, "componentPath" | "id" | "frame" | "services">, create: () => T): T {
  let map = stores.get(ctx.services);
  if (!map) stores.set(ctx.services, (map = new Map()));
  const key = instanceKey(ctx);
  const restartCount = restartGeneration(ctx.services);
  let entry = map.get(key) as StoreEntry<T> | undefined;
  if (!entry || entry.restartCount !== restartCount || ctx.frame < entry.frame) {
    entry = { value: create(), frame: ctx.frame, restartCount };
    map.set(key, entry);
  }
  entry.frame = ctx.frame;
  return entry.value;
}

/** Forget an instance's shared state. */
export function dropInstanceStore(services: RuntimeServices, key: string): void {
  stores.get(services)?.delete(key);
}

/** Degrees in [0, 360). */
export function normalizeDegrees(angle: number): number {
  const r = angle % 360;
  const out = r < 0 ? r + 360 : r;
  return out === 0 || Object.is(out, -0) ? 0 : out;
}

/** True for promises and other thenables. */
export function isThenable<T = unknown>(value: unknown): value is PromiseLike<T> {
  return (typeof value === "object" || typeof value === "function") && value !== null && typeof (value as { then?: unknown }).then === "function";
}

/** An error or rejection as readable text. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return String(error);
}
