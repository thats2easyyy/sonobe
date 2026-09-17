/**
 * Asset import: turn a dropped or picked file into a content-addressed asset (assets/<sha256>.<ext>)
 * with one undoable `addAsset` op, and hand its bytes to the host, which serves them right away and
 * writes them into the project on the next save. Importing the same bytes again reuses the record.
 * Also drag-and-drop helpers panels attach to their surfaces.
 */

import { slugify, uniqueId, type ApplyOpsResult, type AssetKind, type AssetRecord, type Author, type Id } from "@sonobe/core";
import type { HostAdapter } from "../host/types.ts";
import { sha256Hex, toUint8Array } from "./bytes.ts";
import type { DocumentStore } from "./document.ts";

/** A file's name and bytes (for callers that don't have a DOM File). */
export interface ImportableFile {
  name: string;
  bytes: ArrayBuffer | Uint8Array;
  mime?: string;
}

/** The part of a DOM File this module reads. */
export interface FileLike {
  readonly name: string;
  readonly type?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type AssetImportInput = ImportableFile | FileLike;

export interface AssetImportOptions {
  /** Display name. Default: the file name without its extension. */
  name?: string;
  /** History label. Default `Import "<name>"`. */
  label?: string;
  author?: Author;
  /** Override the detected kind. */
  kind?: AssetKind;
}

export interface AssetImportResult {
  ok: boolean;
  assetId?: Id;
  record?: AssetRecord;
  /** An asset with the same bytes already existed, so no op was applied. */
  reused?: boolean;
  /** Human-first explanation when !ok. */
  error?: string;
  errorCode?: "unsupported" | "too_large" | "read_failed" | "apply_failed";
  result?: ApplyOpsResult;
}

export interface MediaProbe {
  width?: number;
  height?: number;
  duration?: number;
}

export interface AssetService {
  importFile(file: AssetImportInput, options?: AssetImportOptions): Promise<AssetImportResult>;
  /** Import several files in order (one undo step each). */
  importFiles(files: Iterable<AssetImportInput> | ArrayLike<AssetImportInput>, options?: Omit<AssetImportOptions, "name">): Promise<AssetImportResult[]>;
  /** Hold bytes for an asset file (through the host when it can store them). */
  storeBytes(file: string, bytes: ArrayBuffer | Uint8Array): void;
  /** Bytes for an asset file held in memory right now. */
  peekBytes(file: string): ArrayBuffer | undefined;
  /** Bytes of a document asset, reading from disk or storage when needed. */
  readBytes(assetId: Id): Promise<ArrayBuffer | undefined>;
  /** Object URL for bytes this service holds itself (hosts without byte storage). */
  resolveUrl(file: string): string | undefined;
  dispose(): void;
}

export interface AssetServiceOptions {
  document: DocumentStore;
  host: HostAdapter | null;
  /** Measure images and media. Default: DOM decoding when available. */
  probe?: (bytes: Uint8Array, kind: AssetKind, mime: string) => Promise<MediaProbe>;
  /** Largest file accepted. Default 512 MB. */
  maxBytes?: number;
}

const EXTENSIONS: Record<AssetKind, readonly string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "heic", "heif"],
  video: ["mp4", "webm", "mov", "m4v", "ogv"],
  sound: ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus"],
  font: ["ttf", "otf", "woff", "woff2"],
  lottie: ["lottie"],
  json: ["json"],
};

const MIME_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "font/woff": "woff",
  "font/woff2": "woff2",
  "application/json": "json",
};

const MIME_BY_EXTENSION: Record<string, string> = {
  ...Object.fromEntries(Object.entries(MIME_EXTENSION).map(([mime, ext]) => [ext, mime])),
  jpeg: "image/jpeg",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
  m4v: "video/mp4",
  ogv: "video/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  lottie: "application/zip",
};

/** Lowercase extension of a file name ("" when there's none). */
export function fileExtension(name: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return match ? match[1]!.toLowerCase() : "";
}

const looksLikeLottie = (bytes: Uint8Array): boolean => {
  try {
    const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4_000_000)));
    const value: unknown = JSON.parse(text);
    return !!value && typeof value === "object" && "layers" in value && ("v" in value || "fr" in value);
  } catch {
    return false;
  }
};

/** What kind of asset a file is, from its extension or MIME type (undefined when unsupported). */
export function assetKindFor(name: string, mime = "", bytes?: Uint8Array): AssetKind | undefined {
  const ext = fileExtension(name);
  for (const [kind, list] of Object.entries(EXTENSIONS) as [AssetKind, readonly string[]][]) {
    if (!list.includes(ext)) continue;
    if (kind === "json" && bytes && looksLikeLottie(bytes)) return "lottie";
    return kind;
  }
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "sound";
  if (mime.startsWith("font/")) return "font";
  if (mime === "application/json") return bytes && looksLikeLottie(bytes) ? "lottie" : "json";
  return undefined;
}

/** DOM Files have arrayBuffer() (and, in newer runtimes, a bytes() method, so don't test for "bytes"). */
const isImportableFile = (input: AssetImportInput): input is ImportableFile => typeof (input as Partial<FileLike>).arrayBuffer !== "function";

type DomWindow = {
  document?: Document;
  createImageBitmap?: (blob: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
};

/** Decode an image or read media metadata in the DOM (empty when that isn't possible). */
export async function probeMedia(bytes: Uint8Array, kind: AssetKind, mime: string): Promise<MediaProbe> {
  const win = (typeof window === "undefined" ? undefined : window) as unknown as DomWindow | undefined;
  if (!win || typeof Blob === "undefined") return {};
  const blob = new Blob([bytes as BlobPart], { type: mime });
  if (kind === "image" && mime !== "image/svg+xml" && typeof win.createImageBitmap === "function") {
    try {
      const bitmap = await win.createImageBitmap(blob);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      if (size.width > 0 && size.height > 0) return size;
    } catch {
      // Fall back to an <img>.
    }
  }
  if ((kind !== "image" && kind !== "video" && kind !== "sound") || !win.document || typeof URL?.createObjectURL !== "function") return {};
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<MediaProbe>((resolve) => {
      const done = (probe: MediaProbe) => {
        clearTimeout(timer);
        resolve(probe);
      };
      const timer = setTimeout(() => done({}), 4000);
      if (kind === "image") {
        const img = win.document!.createElement("img");
        img.onload = () => done(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : {});
        img.onerror = () => done({});
        img.src = url;
        return;
      }
      const el = win.document!.createElement(kind === "video" ? "video" : "audio");
      el.preload = "metadata";
      el.muted = true;
      el.onloadedmetadata = () => {
        const probe: MediaProbe = {};
        if (Number.isFinite(el.duration) && el.duration > 0) probe.duration = el.duration;
        if (el instanceof HTMLVideoElement && el.videoWidth > 0) {
          probe.width = el.videoWidth;
          probe.height = el.videoHeight;
        }
        done(probe);
      };
      el.onerror = () => done({});
      el.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

const SUPPORTED_HINT = "Import images (PNG, JPEG, GIF, WebP, SVG), videos (MP4, WebM, MOV), sounds (MP3, WAV, M4A, OGG), fonts (TTF, OTF, WOFF), Lottie, or JSON files.";

export function createAssetService(options: AssetServiceOptions): AssetService {
  const { document, host } = options;
  const maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
  const probe = options.probe ?? probeMedia;
  const memory = new Map<string, ArrayBuffer>();
  const urls = new Map<string, string>();
  const projectPath = () => document.getState().projectPath;

  const service: AssetService = {
    storeBytes(file, bytes) {
      const buffer = toUint8Array(bytes).slice().buffer as ArrayBuffer;
      if (host?.putAssetBytes) host.putAssetBytes(projectPath(), file, buffer);
      else {
        memory.set(file, buffer);
        const url = urls.get(file);
        if (url) {
          URL.revokeObjectURL(url);
          urls.delete(file);
        }
      }
    },

    peekBytes: (file) => host?.peekAssetBytes?.(projectPath(), file) ?? memory.get(file),

    async readBytes(assetId) {
      const record = document.getState().doc.assets[assetId];
      if (!record) return undefined;
      const held = service.peekBytes(record.file);
      if (held) return held;
      return host?.readAssetBytes ? host.readAssetBytes(projectPath(), record.file) : undefined;
    },

    resolveUrl(file) {
      const cached = urls.get(file);
      if (cached) return cached;
      const bytes = memory.get(file);
      if (!bytes || typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof Blob === "undefined") return undefined;
      const mime = MIME_BY_EXTENSION[fileExtension(file)] ?? "application/octet-stream";
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      urls.set(file, url);
      return url;
    },

    async importFile(input, importOptions = {}) {
      let bytes: Uint8Array;
      try {
        bytes = isImportableFile(input) ? toUint8Array(input.bytes) : new Uint8Array(await input.arrayBuffer());
      } catch (err) {
        return { ok: false, errorCode: "read_failed", error: `Couldn't read "${input.name}": ${err instanceof Error ? err.message : String(err)}` };
      }
      const fileName = input.name || "Untitled";
      if (bytes.byteLength > maxBytes) {
        return { ok: false, errorCode: "too_large", error: `"${fileName}" is ${Math.round(bytes.byteLength / 1048576)} MB, which is more than Sonobe imports (${Math.round(maxBytes / 1048576)} MB).` };
      }
      const declaredMime = isImportableFile(input) ? (input.mime ?? "") : (input.type ?? "");
      const kind = importOptions.kind ?? assetKindFor(fileName, declaredMime, bytes);
      if (!kind) {
        const ext = fileExtension(fileName);
        return { ok: false, errorCode: "unsupported", error: `Sonobe can't use ${ext ? `.${ext}` : "these"} files. ${SUPPORTED_HINT}` };
      }
      const ext = fileExtension(fileName) || MIME_EXTENSION[declaredMime] || (kind === "lottie" ? "json" : kind === "json" ? "json" : "bin");
      const mime = declaredMime || MIME_BY_EXTENSION[ext] || "application/octet-stream";
      const sha256 = await sha256Hex(bytes);
      const file = `${sha256}.${ext}`;

      const existing = Object.values(document.getState().doc.assets).find((a) => a.sha256 === sha256 || a.file === file);
      if (existing) {
        if (!service.peekBytes(existing.file)) service.storeBytes(existing.file, bytes);
        return { ok: true, assetId: existing.id, record: existing, reused: true };
      }

      let measured: MediaProbe = {};
      try {
        measured = await probe(bytes, kind, mime);
      } catch {
        measured = {};
      }
      const baseName = importOptions.name ?? (fileName.replace(/\.[A-Za-z0-9]{1,8}$/, "") || fileName);
      const doc = document.getState().doc;
      const id = uniqueId(slugify(baseName, "asset"), (candidate) => candidate in doc.assets);
      const record: AssetRecord = { id, kind, name: baseName, file, mime, sha256 };
      if (measured.width !== undefined && measured.width > 0 && measured.height !== undefined && measured.height > 0) {
        record.width = Math.round(measured.width);
        record.height = Math.round(measured.height);
      }
      if (measured.duration !== undefined && Number.isFinite(measured.duration) && measured.duration > 0) record.duration = measured.duration;

      service.storeBytes(file, bytes);
      const result = document.getState().apply([{ op: "addAsset", asset: record }], { label: importOptions.label ?? `Import "${baseName}"`, ...(importOptions.author ? { author: importOptions.author } : {}) });
      if (!result.ok) return { ok: false, errorCode: "apply_failed", error: result.errors[0]?.message ?? `Couldn't add "${baseName}".`, result };
      return { ok: true, assetId: id, record, result };
    },

    async importFiles(files, importOptions = {}) {
      const out: AssetImportResult[] = [];
      for (const file of Array.from(files as ArrayLike<AssetImportInput>)) out.push(await service.importFile(file, importOptions));
      return out;
    },

    dispose() {
      for (const url of urls.values()) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Not an object URL environment.
        }
      }
      urls.clear();
      memory.clear();
    },
  };
  return service;
}

// ---------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------

/** The part of DataTransfer read here. */
export interface DataTransferLike {
  readonly types?: ArrayLike<string> | readonly string[];
  readonly files?: ArrayLike<File> | null;
  readonly items?: ArrayLike<{ kind: string; getAsFile(): File | null }> | null;
  dropEffect?: string;
}

/** The part of a drag event read here (React DragEvent and DOM DragEvent both fit). */
export interface DragEventLike {
  readonly dataTransfer: DataTransferLike | null;
  preventDefault(): void;
  stopPropagation?(): void;
}

/** True when a drag carries files. */
export function dragHasFiles(data: DataTransferLike | null | undefined): boolean {
  if (!data) return false;
  if (data.types && Array.from(data.types).includes("Files")) return true;
  return (data.files?.length ?? 0) > 0;
}

/** Files of a drop (items first, which also covers pasted screenshots). */
export function filesFromDataTransfer(data: DataTransferLike | null | undefined): File[] {
  if (!data) return [];
  const fromItems: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) fromItems.push(file);
  }
  return fromItems.length ? fromItems : Array.from(data.files ?? []);
}

export interface AssetDropOptions {
  /** Called after the dropped files were imported (failures included). */
  onImported?: (results: AssetImportResult[], event: DragEventLike) => void;
  /** Only import files this accepts. Default: every file. */
  accept?: (file: File) => boolean;
  /** Highlight changes while files are dragged over the target. */
  onDragActiveChange?: (active: boolean) => void;
  importOptions?: Omit<AssetImportOptions, "name">;
}

export interface AssetDropHandlers {
  onDragEnter(event: DragEventLike): void;
  onDragOver(event: DragEventLike): void;
  onDragLeave(event: DragEventLike): void;
  onDrop(event: DragEventLike): void;
}

/** Drag handlers that import dropped files (spread onto an element: `<div {...handlers}>`). */
export function createAssetDropHandlers(assets: AssetService, options: AssetDropOptions = {}): AssetDropHandlers {
  let depth = 0;
  const setActive = (active: boolean) => options.onDragActiveChange?.(active);
  return {
    onDragEnter(event) {
      if (!dragHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (depth++ === 0) setActive(true);
    },
    onDragOver(event) {
      if (!dragHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave(event) {
      if (!dragHasFiles(event.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    },
    onDrop(event) {
      const files = filesFromDataTransfer(event.dataTransfer).filter((file) => options.accept?.(file) ?? true);
      if (depth > 0) {
        depth = 0;
        setActive(false);
      }
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation?.();
      void assets.importFiles(files, options.importOptions).then((results) => options.onImported?.(results, event));
    },
  };
}

/** Attach drop-to-import to a DOM element. Returns detach. */
export function attachAssetDrop(element: HTMLElement, assets: AssetService, options: AssetDropOptions = {}): () => void {
  const handlers = createAssetDropHandlers(assets, options);
  const listeners: [string, (e: Event) => void][] = [
    ["dragenter", (e) => handlers.onDragEnter(e as DragEvent)],
    ["dragover", (e) => handlers.onDragOver(e as DragEvent)],
    ["dragleave", (e) => handlers.onDragLeave(e as DragEvent)],
    ["drop", (e) => handlers.onDrop(e as DragEvent)],
  ];
  for (const [type, fn] of listeners) element.addEventListener(type, fn);
  return () => {
    for (const [type, fn] of listeners) element.removeEventListener(type, fn);
  };
}
