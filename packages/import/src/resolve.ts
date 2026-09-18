/**
 * Files for a capture (images by their keys, fonts under "font:<index>"): data: URLs decode in place;
 * http(s) URLs go through the host's fetcher (the desktop app downloads with the capture window's
 * session, so localhost cookies work), with size and time limits. Anything that fails resolves to null:
 * planImport draws a placeholder for an image and leaves a font to the system.
 */

import type { DesignCapture } from "./capture.ts";
import type { ResolvedImage } from "./convert.ts";

export type ImageFetcher = (url: string, signal: AbortSignal) => Promise<{ bytes: Uint8Array; mime: string } | null>;

export interface ResolveImagesOptions {
  /** Downloads http(s) images. Without it, only data: URLs resolve. */
  fetch?: ImageFetcher;
  /** Largest image accepted. Default 25 MB. */
  maxBytes?: number;
  /** Most bytes for all images together. Default 150 MB. */
  maxTotalBytes?: number;
  /** Per-image download timeout. Default 15 s. */
  timeoutMs?: number;
  /** Downloads at once. Default 6. */
  concurrency?: number;
}

/** Decode a data: URL; null when it isn't one. */
export function decodeDataUrl(url: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,([\s\S]*)$/i.exec(url);
  if (!m) return null;
  const mime = (m[1] || "text/plain").toLowerCase();
  try {
    if (m[3]) {
      const binary = atob(m[4]!.replace(/\s+/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { bytes, mime };
    }
    return { bytes: new TextEncoder().encode(decodeURIComponent(m[4]!)), mime };
  } catch {
    return null;
  }
}

/** A fetcher over the global fetch (browsers need CORS; Node and Electron main don't). */
export function globalFetcher(init: RequestInit = {}): ImageFetcher {
  return async (url, signal) => {
    const response = await fetch(url, { ...init, signal });
    if (!response.ok) return null;
    return { bytes: new Uint8Array(await response.arrayBuffer()), mime: response.headers.get("content-type") ?? "" };
  };
}

export async function resolveCaptureFiles(capture: DesignCapture, options: ResolveImagesOptions = {}): Promise<Map<string, ResolvedImage | null>> {
  const maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
  let budget = options.maxTotalBytes ?? 150 * 1024 * 1024;
  const out = new Map<string, ResolvedImage | null>();
  const queue: [string, { url: string; mime?: string; width?: number; height?: number }][] = [...Object.entries(capture.images), ...(capture.fonts ?? []).map((f, i) => [`font:${i}`, { url: f.url }] as [string, { url: string }])];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [key, source] = item;
      let got: { bytes: Uint8Array; mime: string } | null = null;
      if (source.url.startsWith("data:")) got = decodeDataUrl(source.url);
      else if (/^https?:/i.test(source.url) && options.fetch) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
        try {
          got = await options.fetch(source.url, controller.signal);
        } catch {
          got = null;
        } finally {
          clearTimeout(timer);
        }
      }
      if (got && got.bytes.byteLength > 0 && got.bytes.byteLength <= maxBytes && got.bytes.byteLength <= budget) {
        budget -= got.bytes.byteLength;
        const resolved: ResolvedImage = { bytes: got.bytes, mime: got.mime || source.mime || "" };
        if (source.width) resolved.width = source.width;
        if (source.height) resolved.height = source.height;
        out.set(key, resolved);
      } else out.set(key, null);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 6) }, worker));
  return out;
}
