/**
 * Helpers shared by the media patches: media and layer references, live sources, loadable URLs,
 * asset existence, layer types, whole-integer inputs, looped-input warnings, and releasing
 * host-created media.
 */

import type { AssetRef, LayerRef } from "@sonobe/core";
import type { PatchContext, RuntimeServices } from "@sonobe/engine";
import { finiteOr, isPlainObject, toText, warnOnce } from "../infra/index.ts";

/** The interim live-source encoding (`{ url: "sonobe-live:<kind>/<key>" }`) from before `AssetRef.live`; still read, never written. */
export const LIVE_URL_PREFIX = "sonobe-live:";

/** True for `{ assetId }`, `{ url }`, or `{ live }` references. */
export function isAssetRef(value: unknown): value is AssetRef {
  return isPlainObject(value) && (typeof value.assetId === "string" || typeof value.url === "string" || typeof value.live === "string");
}

/** True for `{ layerId }` references. */
export function isLayerRef(value: unknown): value is LayerRef {
  return isPlainObject(value) && typeof value.layerId === "string";
}

/** A stable identity for a media reference: "asset:<id>", "url:<url>", "live:<key>", or "" for none. */
export function refKey(ref: AssetRef | null | undefined): string {
  if (!ref) return "";
  if (typeof ref.assetId === "string") return `asset:${ref.assetId}`;
  if (typeof ref.url === "string") return `url:${ref.url}`;
  if (typeof ref.live === "string") return `live:${ref.live}`;
  return "";
}

/** A stable identity for a layer reference, including its loop instance. */
export function layerKey(ref: LayerRef | null | undefined): string {
  return ref ? `${ref.layerId}#${typeof ref.instance === "number" ? ref.instance : ""}` : "";
}

/** True for live sources such as `{ live: "audio/main/player#0" }` (camera feeds, microphones, player metering). */
export function isLiveHandle(ref: AssetRef | null | undefined): boolean {
  return liveHandleKey(ref) !== "";
}

/** The live source naming a patch instance's sound or feed. */
export function liveHandle(kind: "audio" | "camera" | "microphone", key: string): AssetRef {
  return { live: `${kind}/${key}` };
}

/** A live source's key, e.g. "audio/main/player#0", or "" for other references. */
export function liveHandleKey(ref: AssetRef | null | undefined): string {
  if (!ref) return "";
  if (typeof ref.live === "string") return ref.live;
  return typeof ref.url === "string" && ref.url.startsWith(LIVE_URL_PREFIX) ? ref.url.slice(LIVE_URL_PREFIX.length) : "";
}

/** True for URLs a picture or clip can load from: http:, https:, blob:, or a data: URL of that kind. */
export function isLoadableUrl(url: string, kind: "image" | "video"): boolean {
  return /^(https?|blob):/i.test(url) || url.toLowerCase().startsWith(`data:${kind}/`);
}

/** A URL reference, a live source, or an asset id the host can resolve. */
export function assetExists(ctx: Pick<PatchContext, "services">, ref: AssetRef): boolean {
  if (typeof ref.url === "string") return ref.url !== "";
  if (typeof ref.assetId !== "string") return typeof ref.live === "string" && ref.live !== "";
  try {
    return ctx.services.resolveAssetUrl(ref.assetId) !== undefined;
  } catch {
    return false;
  }
}

/** The layer's type key from the previous frame's snapshot, or undefined when the layer isn't in the scene. */
export function layerTypeOf(ctx: Pick<PatchContext, "services">, layer: LayerRef): string | undefined {
  try {
    const type = ctx.services.layerInfo(layer)?.type;
    return typeof type === "string" ? type : undefined;
  } catch {
    return undefined;
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
    services.platform.releaseMedia?.(ref);
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
