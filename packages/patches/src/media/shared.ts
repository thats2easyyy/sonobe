/**
 * Helpers shared by the media patches: muted behavior, media and layer references, live handles,
 * loadable URLs, asset existence, whole-integer inputs, looped-input warnings, and releasing
 * host-created media.
 */

import type { AssetRef, LayerRef } from "@sonobe/core";
import type { MutedBehavior, PatchContext, PatchDefinition, RuntimePatchDefinition, RuntimeServices } from "@sonobe/engine";
import { finiteOr, isPlainObject, toText, warnOnce } from "../infra/index.ts";
import { mediaPlatform } from "./platform.ts";

/** Attach the engine's `mutedBehavior` extension to a definition. */
export function withMutedBehavior<S>(definition: PatchDefinition<S>, mutedBehavior: MutedBehavior): RuntimePatchDefinition<S> {
  return Object.assign(definition, { mutedBehavior });
}

/** URL scheme of live media handles (Metering outputs, camera feeds). */
export const LIVE_URL_PREFIX = "sonobe-live:";

/** True for `{ assetId }` or `{ url }` references. */
export function isAssetRef(value: unknown): value is AssetRef {
  return isPlainObject(value) && (typeof value.assetId === "string" || typeof value.url === "string");
}

/** True for `{ layerId }` references. */
export function isLayerRef(value: unknown): value is LayerRef {
  return isPlainObject(value) && typeof value.layerId === "string";
}

/** A stable identity for a media reference: "asset:<id>", "url:<url>", or "" for none. */
export function refKey(ref: AssetRef | null | undefined): string {
  if (!ref) return "";
  if (typeof ref.assetId === "string") return `asset:${ref.assetId}`;
  if (typeof ref.url === "string") return `url:${ref.url}`;
  return "";
}

/** A stable identity for a layer reference, including its loop instance. */
export function layerKey(ref: LayerRef | null | undefined): string {
  return ref ? `${ref.layerId}#${typeof ref.instance === "number" ? ref.instance : ""}` : "";
}

/** True for live handles such as `{ url: "sonobe-live:audio/main/player#0" }`. */
export function isLiveHandle(ref: AssetRef | null | undefined): boolean {
  return typeof ref?.url === "string" && ref.url.startsWith(LIVE_URL_PREFIX);
}

/** The live handle naming a patch instance's sound or feed. */
export function liveHandle(kind: "audio" | "camera" | "microphone", key: string): AssetRef {
  return { url: `${LIVE_URL_PREFIX}${kind}/${key}` };
}

/** The part of a live handle after the scheme, e.g. "audio/main/player#0". */
export function liveHandleKey(ref: AssetRef): string {
  return typeof ref.url === "string" && ref.url.startsWith(LIVE_URL_PREFIX) ? ref.url.slice(LIVE_URL_PREFIX.length) : "";
}

/** True for URLs a picture or clip can load from: http:, https:, blob:, or a data: URL of that kind. */
export function isLoadableUrl(url: string, kind: "image" | "video"): boolean {
  return /^(https?|blob):/i.test(url) || url.toLowerCase().startsWith(`data:${kind}/`);
}

/** A URL reference, or an asset id the host can resolve. */
export function assetExists(ctx: Pick<PatchContext, "services">, ref: AssetRef): boolean {
  if (typeof ref.url === "string") return ref.url !== "";
  if (typeof ref.assetId !== "string") return false;
  try {
    return ctx.services.resolveAssetUrl(ref.assetId) !== undefined;
  } catch {
    return false;
  }
}

/** `floor(value)` clamped to [lo, hi]; non-finite values use `fallback`. */
export function clampInt(value: unknown, fallback: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.floor(finiteOr(value, fallback))));
}

/** An enum input that must be one of `options`, else `fallback`. */
export function enumOr<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  const text = toText(value);
  return (options as readonly string[]).includes(text) ? (text as T) : fallback;
}

/** Warn once per restart when any of `keys` carries a loop (whole-loop patches use item 0). */
export function warnLoopedInputs(ctx: PatchContext, keys: readonly string[], patchName: string): void {
  for (const key of keys) {
    if (ctx.inputItems(key).length !== 1) {
      warnOnce(ctx, "loopedInputs", `${patchName}: inputs don't loop, so a looped input uses its first item.`);
      return;
    }
  }
}

/** Ask the host to release a reference it created (blob URLs, decoded buffers). */
export function releaseRef(services: RuntimeServices, ref: AssetRef | null | undefined): void {
  if (!ref) return;
  try {
    mediaPlatform(services).releaseMedia?.(ref);
  } catch {
    // Already released.
  }
}

/** An error or rejection as readable text. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (isPlainObject(error) && typeof error.message === "string") return error.message;
  return String(error);
}

/** Call a host method, swallowing failures (hosts may throw after a device goes away). */
export function safely(action: () => void): void {
  try {
    action();
  } catch {
    // The host already cleaned up.
  }
}
