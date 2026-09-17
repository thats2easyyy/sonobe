/**
 * Helpers shared by the device patches: declaring a muted behavior, finite vectors that warn once,
 * preset lookup without a fallback, the simulation-clock check, and per-instance stores for state
 * one patch instance shares across its loop indices.
 */

import { DEVICE_PRESETS } from "@sonobe/core";
import type { DevicePreset } from "@sonobe/core";
import { DETERMINISTIC_EPOCH_MS } from "@sonobe/engine";
import type { MutedBehavior, PatchContext, PatchDefinition, RuntimePatchDefinition, RuntimeServices } from "@sonobe/engine";
import { warnOnce } from "../infra/index.ts";

/** Attach the engine's `mutedBehavior` extension to a definition. */
export function withMutedBehavior<S>(definition: PatchDefinition<S>, mutedBehavior: MutedBehavior): RuntimePatchDefinition<S> {
  return Object.assign(definition, { mutedBehavior });
}

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

/**
 * True when `services.now()` is the deterministic simulation clock (the fixed epoch plus
 * prototype time). The contract doesn't expose `deterministic` to patches, so this is how Device
 * Time picks UTC and Location picks its simulation message.
 */
export function isSimulationClock(ctx: Pick<PatchContext, "services" | "time">): boolean {
  const now = ctx.services.now();
  return typeof now === "number" && Math.abs(now - (DETERMINISTIC_EPOCH_MS + ctx.time * 1000)) < 1e-3;
}

interface StoreEntry<T> {
  value: T;
  frame: number;
}

const stores = new WeakMap<RuntimeServices, Map<string, StoreEntry<unknown>>>();

/** Key of a patch instance: component path plus patch id (loop indices share it). */
export function instanceKey(ctx: Pick<PatchContext, "componentPath" | "id">): string {
  return `${ctx.componentPath}/${ctx.id}`;
}

/**
 * State shared by every loop index of one patch instance, created on first use. A frame counter
 * that went backwards (a restart) creates it again.
 */
export function instanceStore<T>(ctx: Pick<PatchContext, "componentPath" | "id" | "frame" | "services">, create: () => T): T {
  let map = stores.get(ctx.services);
  if (!map) stores.set(ctx.services, (map = new Map()));
  const key = instanceKey(ctx);
  let entry = map.get(key) as StoreEntry<T> | undefined;
  if (!entry || ctx.frame < entry.frame) {
    entry = { value: create(), frame: ctx.frame };
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

/** An error or rejection as readable text. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return String(error);
}
