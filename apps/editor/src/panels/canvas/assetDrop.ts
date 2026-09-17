/**
 * Media files dropped on the canvas become layers: images → Image, videos → Video, Lottie JSON or
 * dotLottie → Lottie. Files are imported through the session's asset importer when it has one
 * (`session.assets`), sized to their natural size (scaled down to fit the artboard), and centered on
 * the drop point inside the group under it.
 */

import type { AssetRecord, Id, InputValue, NewLayer, Op, SonobeDocument } from "@sonobe/core";
import type { EditorSession } from "../../state/session.ts";
import { roundTo, type Point } from "./geometry.ts";
import { cleanPoint } from "./ops.ts";
import { toParentSpace } from "./transform.ts";

export type MediaKind = "image" | "video" | "lottie";

/** The layer type and the prop that holds the media, per kind. */
export const MEDIA_LAYER: Readonly<Record<MediaKind, { type: string; prop: string; label: string }>> = {
  image: { type: "image", prop: "image", label: "Image" },
  video: { type: "video", prop: "video", label: "Video" },
  lottie: { type: "lottie", prop: "animation", label: "Lottie" },
};

/** Size used when a file's natural size can't be read. */
export const DEFAULT_MEDIA_SIZE: Readonly<Record<MediaKind, Point>> = { image: [200, 200], video: [320, 180], lottie: [240, 240] };

/** Lottie JSON up to this size is stored inline when there's no asset importer. */
export const INLINE_LOTTIE_LIMIT = 512 * 1024;

/** How far each additional dropped file is offset from the previous one. */
export const DROP_CASCADE = 20;

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "apng", "ico"]);
const VIDEO_EXT = new Set(["mp4", "m4v", "mov", "webm", "ogv"]);

export interface DroppedFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
}

/**
 * A file as `{ name, bytes, mime }` for the editor's AssetService. Passing the DOM File itself isn't
 * safe: Chromium Files have a `bytes()` method, which the service's `"bytes" in input` check mistakes
 * for raw bytes, so it would import an empty file.
 */
async function importableFile(file: DroppedFile): Promise<{ name: string; bytes: Uint8Array; mime?: string } | DroppedFile> {
  if (typeof file.arrayBuffer !== "function") return file;
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), ...(file.type ? { mime: file.type } : {}) };
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** What a file becomes on the canvas, or null when it isn't media Sonobe can show. JSON is checked later. */
export function classifyMediaFile(file: { name: string; type: string }): MediaKind | null {
  const ext = fileExtension(file.name);
  const mime = file.type.toLowerCase();
  if (ext === "lottie" || mime.includes("dotlottie")) return "lottie";
  if (ext === "json" || mime === "application/json") return "lottie";
  if (mime.startsWith("image/") || IMAGE_EXT.has(ext)) return "image";
  if (mime.startsWith("video/") || VIDEO_EXT.has(ext)) return "video";
  return null;
}

/** A Bodymovin (Lottie) animation: a layers array plus a version or frame rate. */
export function isLottieJson(value: unknown): value is { layers: unknown[]; w?: number; h?: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.layers) && (typeof v.v === "string" || typeof v.fr === "number");
}

export function lottieSize(json: { w?: unknown; h?: unknown }): Point | null {
  return typeof json.w === "number" && typeof json.h === "number" && json.w > 0 && json.h > 0 ? [json.w, json.h] : null;
}

/** "hero-photo@2x.png" → "hero-photo@2x"; falls back to the kind's label. */
export function mediaLayerName(fileName: string, kind: MediaKind): string {
  const base = (fileName.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "").trim();
  return base || MEDIA_LAYER[kind].label;
}

/** A natural size scaled down (never up) to fit `bounds`, in whole points. Null for unusable sizes. */
export function fitMediaSize(natural: readonly number[] | null | undefined, bounds: readonly [number, number]): Point | null {
  const w = natural?.[0];
  const h = natural?.[1];
  if (typeof w !== "number" || typeof h !== "number" || !(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  const s = Math.min(1, bounds[0] > 0 ? bounds[0] / w : 1, bounds[1] > 0 ? bounds[1] / h : 1);
  // Round through 6 decimals first so 600 × (402 / 800) = 301.4999… lands on 302.
  const whole = (n: number) => Math.max(1, Math.round(Number(n.toFixed(6))));
  return [whole(w * s), whole(h * s)];
}

interface DataTransferLike {
  types?: readonly string[] | DOMStringList;
  items?: ArrayLike<{ kind: string; type: string }>;
  files?: ArrayLike<{ name: string; type: string }>;
}

const hasType = (types: DataTransferLike["types"], type: string) => !!types && Array.from(types as ArrayLike<string>).includes(type);

/** True when a drag carries files. */
export function dragHasFiles(dt: DataTransferLike | null | undefined): boolean {
  return !!dt && hasType(dt.types, "Files");
}

/** The pill shown while dragging files over the canvas. Only MIME types are readable before the drop. */
export function dropLabel(dt: DataTransferLike | null | undefined): string {
  const items = dt?.items ? Array.from(dt.items).filter((i) => i.kind === "file") : [];
  if (items.length > 1) return `Add ${items.length} files`;
  const mime = items[0]?.type.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return "Add image";
  if (mime.startsWith("video/")) return "Add video";
  if (mime === "application/json" || mime.includes("lottie")) return "Add Lottie animation";
  return "Add file";
}

// ---------------------------------------------------------------------------
// Asset importer (session.assets)
// ---------------------------------------------------------------------------

export interface ImportResult {
  records: AssetRecord[];
  error: string | null;
}

export interface AssetImporter {
  importFile(file: DroppedFile): Promise<ImportResult>;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isFn = (v: unknown): v is (...args: unknown[]) => unknown => typeof v === "function";

export function isAssetRecord(v: unknown): v is AssetRecord {
  return isObject(v) && typeof v.id === "string" && typeof v.kind === "string" && typeof v.file === "string";
}

function errorText(v: unknown): string | null {
  if (typeof v === "string" && v) return v;
  if (isObject(v)) {
    if (typeof v.message === "string" && v.message) return v.message;
    if (Array.isArray(v.errors) && v.errors.length) return errorText(v.errors[0]);
    if (v.error !== undefined) return errorText(v.error);
  }
  return null;
}

/** Asset records (and any error) from whatever an importer returned. */
export function normalizeImportResult(value: unknown, doc: SonobeDocument): ImportResult {
  const records: AssetRecord[] = [];
  const seen = new Set<string>();
  const push = (r: AssetRecord) => {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      records.push(r);
    }
  };
  const visit = (v: unknown, depth: number) => {
    if (depth > 4 || v === null || v === undefined) return;
    if (typeof v === "string") {
      const record = doc.assets[v];
      if (record) push(record);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    if (isAssetRecord(v)) {
      push(v);
      return;
    }
    if (!isObject(v)) return;
    for (const key of ["asset", "record", "assets", "records", "assetId", "id"]) if (key in v) visit(v[key], depth + 1);
  };
  visit(value, 0);
  const firstError = (v: unknown, depth: number): string | null => {
    if (depth > 4) return null;
    if (Array.isArray(v)) {
      for (const item of v) {
        const found = firstError(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    return isObject(v) && v.ok === false ? (errorText(v) ?? "The file couldn't be imported.") : null;
  };
  return { records, error: records.length ? null : firstError(value, 0) };
}

/**
 * The session's asset importer (`session.assets`), when it has one: `importFile(file)` (the editor's
 * AssetService, resolving `{ ok, assetId, record, error }`), else `importFiles(files)`, `import(file | files)`,
 * or `add(file | files)`, returning records, ids, or `{ ok, asset(s) }` results.
 */
export function getAssetImporter(session: EditorSession): AssetImporter | null {
  const api = (session as unknown as { assets?: unknown }).assets;
  if (!isObject(api)) return null;
  const call = (fn: (...args: unknown[]) => unknown, arg: unknown) => Promise.resolve(fn.call(api, arg));
  const doc = () => session.document.getState().doc;
  const attempt = async (fn: (...args: unknown[]) => unknown, file: DroppedFile, batch: boolean): Promise<ImportResult> => normalizeImportResult(await call(fn, batch ? [file] : file), doc());
  if (isFn(api.importFile)) {
    const fn = api.importFile;
    return { importFile: async (file) => normalizeImportResult(await call(fn, await importableFile(file)), doc()) };
  }
  if (isFn(api.importFiles)) {
    const fn = api.importFiles;
    return { importFile: async (file) => normalizeImportResult(await call(fn, [await importableFile(file)]), doc()) };
  }
  const flexible = isFn(api.import) ? api.import : isFn(api.add) ? api.add : null;
  if (!flexible) return null;
  return {
    async importFile(file) {
      let first: ImportResult;
      try {
        first = await attempt(flexible, file, false);
      } catch {
        return attempt(flexible, file, true);
      }
      if (first.records.length > 0 || first.error) return first;
      return attempt(flexible, file, true);
    },
  };
}

// ---------------------------------------------------------------------------
// Dropping
// ---------------------------------------------------------------------------

export interface PreparedMedia {
  kind: MediaKind;
  name: string;
  /** The media prop value ({ asset } or inline { json }). */
  value: InputValue;
  natural: Point | null;
}

export interface PreparedDrop {
  items: PreparedMedia[];
  /** addAsset ops for records the importer didn't add to the document itself. */
  assetOps: Op[];
  errors: string[];
}

export interface PrepareOptions {
  importer?: AssetImporter | null;
  /** Natural size of an image or video file. Default: load it in a muted, detached element. */
  measure?: (file: DroppedFile, kind: MediaKind) => Promise<Point | null>;
}

/** Import dropped files and work out what each one becomes. Unsupported files are reported, not thrown. */
export async function prepareDroppedFiles(session: EditorSession, files: readonly DroppedFile[], options: PrepareOptions = {}): Promise<PreparedDrop> {
  const importer = options.importer === undefined ? getAssetImporter(session) : options.importer;
  const measure = options.measure ?? ((file: DroppedFile, kind: MediaKind) => measureMediaFile(file as unknown as Blob, kind));
  const out: PreparedDrop = { items: [], assetOps: [], errors: [] };
  const added = new Set<Id>();
  for (const file of files) {
    const kind = classifyMediaFile(file);
    if (!kind) {
      out.errors.push(`“${file.name}” isn't an image, a video, or a Lottie animation.`);
      continue;
    }
    let json: { layers: unknown[]; w?: number; h?: number } | null = null;
    if (kind === "lottie" && fileExtension(file.name) !== "lottie") {
      try {
        const parsed: unknown = JSON.parse(await file.text());
        if (isLottieJson(parsed)) json = parsed;
      } catch {
        json = null;
      }
      if (!json) {
        out.errors.push(`“${file.name}” isn't a Lottie animation.`);
        continue;
      }
    }
    const name = mediaLayerName(file.name, kind);
    if (importer) {
      let result: ImportResult;
      try {
        result = await importer.importFile(file);
      } catch (err) {
        result = { records: [], error: err instanceof Error ? err.message : String(err) };
      }
      const record = result.records[0];
      if (!record) {
        out.errors.push(`Couldn't add “${file.name}”${result.error ? `: ${result.error}` : "."}`);
        continue;
      }
      if (!session.document.getState().doc.assets[record.id] && !added.has(record.id)) {
        added.add(record.id);
        out.assetOps.push({ op: "addAsset", asset: record });
      }
      const natural = fitMediaSize(record.width !== undefined && record.height !== undefined ? [record.width, record.height] : null, [Infinity, Infinity]) ?? (json ? lottieSize(json) : kind === "lottie" ? null : await measure(file, kind));
      out.items.push({ kind, name, value: { asset: record.id }, natural });
      continue;
    }
    if (json && file.size <= INLINE_LOTTIE_LIMIT) {
      out.items.push({ kind, name, value: { json }, natural: lottieSize(json) });
      continue;
    }
    out.errors.push(json ? `Couldn't add “${file.name}”: it's too large to embed, and this build of Sonobe can't import media files yet.` : `Couldn't add “${file.name}”: this build of Sonobe can't import media files yet.`);
  }
  return out;
}

export interface PlaceMediaOptions {
  componentId: Id;
  /** The drop point (artboard space). The first layer is centered on it. */
  center: Point;
  /** The group the layers go into (null: the component root). */
  parentId: Id | null;
  /** World transform of that group. */
  parentWorld: readonly number[] | null;
  /** Size of what the media lands in (the group's bounds or the artboard, artboard points); larger media is scaled down to fit it. */
  artboard: readonly [number, number];
}

/** addLayer ops for prepared media. Refs are "dropped0", "dropped1"... */
export function mediaLayerOps(items: readonly PreparedMedia[], options: PlaceMediaOptions): { ops: Op[]; refs: string[] } {
  const ops: Op[] = [];
  const refs: string[] = [];
  items.forEach((item, i) => {
    const size = fitMediaSize(item.natural, options.artboard) ?? DEFAULT_MEDIA_SIZE[item.kind];
    const offset = i * DROP_CASCADE;
    const topLeft: Point = [roundTo(options.center[0] - size[0] / 2 + offset), roundTo(options.center[1] - size[1] / 2 + offset)];
    const a = toParentSpace(options.parentWorld, topLeft);
    const b = toParentSpace(options.parentWorld, [topLeft[0] + size[0], topLeft[1] + size[1]]);
    const ref = `dropped${i}`;
    const spec = MEDIA_LAYER[item.kind];
    const layer: NewLayer = {
      ref,
      type: spec.type,
      name: item.name,
      props: { position: cleanPoint([Math.min(a[0], b[0]), Math.min(a[1], b[1])]), size: cleanPoint([Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])]), [spec.prop]: item.value },
    };
    ops.push({ op: "addLayer", component: options.componentId, parent: options.parentId, layer });
    refs.push(ref);
  });
  return { ops, refs };
}

/** Undo label for a drop. */
export function dropUndoLabel(items: readonly PreparedMedia[]): string {
  if (items.length === 1) return `Add ${MEDIA_LAYER[items[0]!.kind].label.toLowerCase() === "lottie" ? "Lottie animation" : MEDIA_LAYER[items[0]!.kind].label.toLowerCase()} “${items[0]!.name}”`;
  return `Add ${items.length} media layers`;
}

/** Natural size of an image or video file, read in a detached, muted element. Null when it can't be read. */
export function measureMediaFile(file: Blob, kind: MediaKind, timeoutMs = 4000): Promise<Point | null> {
  const doc = typeof document === "undefined" ? null : document;
  if (!doc || kind === "lottie" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    let url: string;
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve(null);
      return;
    }
    let done = false;
    let cleanup = () => undefined as void;
    const finish = (size: Point | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      URL.revokeObjectURL(url);
      resolve(size && size[0] > 0 && size[1] > 0 ? size : null);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    if (kind === "image") {
      const img = doc.createElement("img");
      img.onload = () => finish([img.naturalWidth, img.naturalHeight]);
      img.onerror = () => finish(null);
      cleanup = () => {
        img.onload = null;
        img.onerror = null;
      };
      img.src = url;
      return;
    }
    const video = doc.createElement("video");
    video.muted = true;
    video.defaultMuted = true;
    video.autoplay = false;
    video.preload = "metadata";
    video.onloadedmetadata = () => finish([video.videoWidth, video.videoHeight]);
    video.onerror = () => finish(null);
    cleanup = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        // Detached element; nothing to release.
      }
    };
    video.src = url;
  });
}
