/**
 * What the live viewer knows about media: natural sizes, durations, and load status, fed by the
 * renderer (onMediaState for images and videos it draws) and by loading references a patch asks
 * about. The runtime consults it through RuntimeOptions.mediaInfo.
 */

import type { AssetRecord, AssetRef, Id } from "@sonobe/core";
import type { MediaInfo, SceneFrame, SceneNode } from "@sonobe/engine";
import type { MediaState } from "@sonobe/renderer";

export type MediaKind = "image" | "video" | "sound";

export interface MediaInfoCacheOptions {
  resolveAssetUrl: (assetId: Id) => string | undefined;
  assetRecord?: (assetId: Id) => AssetRecord | undefined;
  /**
   * Load references nobody has drawn yet to learn their size and duration. Default: when a DOM
   * exists. A function replaces the DOM loader.
   */
  probe?: boolean | ((url: string, kind: MediaKind) => Promise<{ width: number; height: number; duration: number }>);
}

export interface MediaInfoCache {
  info(ref: AssetRef): MediaInfo | undefined;
  /** A renderer report for media showing `ref`. */
  report(ref: AssetRef, state: MediaState): void;
  /** A renderer report by scene key; finds which media the node shows. Returns that reference. */
  reportForNode(scene: SceneFrame | null, key: string, state: MediaState): AssetRef | undefined;
  clear(): void;
  dispose(): void;
}

/** A media reference from a runtime or document value ({assetId}, {asset}, {url}, or a URL string). */
export function mediaRefOf(value: unknown): AssetRef | undefined {
  if (typeof value === "string") return value ? { url: value } : undefined;
  if (!value || typeof value !== "object") return undefined;
  const v = value as { assetId?: unknown; asset?: unknown; url?: unknown; live?: unknown };
  if (typeof v.live === "string" && v.live) return { live: v.live };
  if (typeof v.url === "string" && v.url) return { url: v.url };
  if (typeof v.assetId === "string" && v.assetId) return { assetId: v.assetId };
  if (typeof v.asset === "string" && v.asset) return { assetId: v.asset };
  return undefined;
}

const sceneIndexes = new WeakMap<SceneFrame, Map<string, SceneNode>>();

/** The scene node with a key (indexed once per frame). */
export function findSceneNode(scene: SceneFrame | null | undefined, key: string): SceneNode | undefined {
  if (!scene) return undefined;
  let index = sceneIndexes.get(scene);
  if (!index) {
    index = new Map();
    const stack = [...scene.roots];
    while (stack.length) {
      const node = stack.pop()!;
      index.set(node.key, node);
      for (const child of node.children) stack.push(child);
    }
    sceneIndexes.set(scene, index);
  }
  return index.get(key);
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|heic)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;
const SOUND_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)(\?|#|$)/i;

function guessKind(url: string, record: AssetRecord | undefined): MediaKind {
  if (record?.kind === "video" || record?.kind === "sound" || record?.kind === "image") return record.kind;
  if (VIDEO_EXT.test(url)) return "video";
  if (SOUND_EXT.test(url)) return "sound";
  if (IMAGE_EXT.test(url)) return "image";
  return "image";
}

function nameOf(url: string): string {
  try {
    const last = new URL(url, "http://local/").pathname.split("/").filter(Boolean).at(-1);
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

type ProbeResult = { width: number; height: number; duration: number };

function domProbe(url: string, kind: MediaKind): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const doc = globalThis.document;
    if (!doc) {
      reject(new Error("no DOM"));
      return;
    }
    if (kind === "image") {
      const img = doc.createElement("img");
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, duration: 0 });
      img.onerror = () => reject(new Error("image failed to load"));
      img.src = url;
      return;
    }
    const el = doc.createElement(kind === "video" ? "video" : "audio");
    el.preload = "metadata";
    el.muted = true;
    el.onloadedmetadata = () => {
      const video = el as HTMLVideoElement;
      resolve({ width: video.videoWidth || 0, height: video.videoHeight || 0, duration: Number.isFinite(el.duration) ? el.duration : 0 });
      el.removeAttribute("src");
    };
    el.onerror = () => reject(new Error("media failed to load"));
    el.src = url;
  });
}

export function createMediaInfoCache(options: MediaInfoCacheOptions): MediaInfoCache {
  const entries = new Map<string, MediaInfo>();
  const probing = new Set<string>();
  let disposed = false;
  const probe = options.probe === undefined ? (typeof document === "undefined" ? false : domProbe) : options.probe === true ? domProbe : options.probe;

  const locate = (ref: AssetRef): { key: string; url?: string; record?: AssetRecord; name: string } | undefined => {
    if (ref.live) return undefined;
    if (ref.assetId) {
      const record = options.assetRecord?.(ref.assetId);
      const url = options.resolveAssetUrl(ref.assetId);
      return { key: url ? `u:${url}` : `a:${ref.assetId}`, ...(url ? { url } : {}), ...(record ? { record } : {}), name: record?.name ?? ref.assetId };
    }
    if (ref.url) return { key: `u:${ref.url}`, url: ref.url, name: nameOf(ref.url) };
    return undefined;
  };

  const cache: MediaInfoCache = {
    info(ref) {
      const where = locate(ref);
      if (!where) return undefined;
      const known = entries.get(where.key);
      if (known) return { ...known };
      const record = where.record;
      if (record && ((record.width ?? 0) > 0 || (record.duration ?? 0) > 0) && !probe) {
        return { status: "ready", width: record.width ?? 0, height: record.height ?? 0, duration: record.duration ?? 0, name: where.name };
      }
      if (!where.url || !probe) return undefined;
      const loading: MediaInfo = { status: "loading", width: record?.width ?? 0, height: record?.height ?? 0, duration: record?.duration ?? 0, name: where.name };
      entries.set(where.key, loading);
      if (!probing.has(where.key)) {
        probing.add(where.key);
        const key = where.key;
        probe(where.url, guessKind(where.url, record)).then(
          (result) => {
            probing.delete(key);
            if (disposed) return;
            const current = entries.get(key);
            entries.set(key, { ...(current ?? loading), status: "ready", width: result.width || current?.width || 0, height: result.height || current?.height || 0, duration: result.duration || current?.duration || 0 });
          },
          () => {
            probing.delete(key);
            if (disposed) return;
            entries.set(key, { ...(entries.get(key) ?? loading), status: "error" });
          },
        );
      }
      return { ...loading };
    },

    report(ref, state) {
      const where = locate(ref);
      if (!where) return;
      const current = entries.get(where.key) ?? { status: "loading" as const, width: where.record?.width ?? 0, height: where.record?.height ?? 0, duration: where.record?.duration ?? 0, name: where.name };
      const next: MediaInfo = { ...current };
      if (state.naturalSize && state.naturalSize[0] > 0 && state.naturalSize[1] > 0) {
        next.width = state.naturalSize[0];
        next.height = state.naturalSize[1];
      }
      if (typeof state.duration === "number" && Number.isFinite(state.duration) && state.duration > 0) next.duration = state.duration;
      if (state.loading === true) next.status = "loading";
      else if (state.loading === false || next.width > 0 || next.duration > 0) next.status = "ready";
      entries.set(where.key, next);
    },

    reportForNode(scene, key, state) {
      const node = findSceneNode(scene, key);
      if (!node) return undefined;
      const ref = mediaRefOf(node.props.image ?? node.props.video ?? node.props.source);
      if (ref) cache.report(ref, state);
      return ref;
    },

    clear() {
      entries.clear();
    },

    dispose() {
      disposed = true;
      entries.clear();
      probing.clear();
    },
  };
  return cache;
}
