/**
 * Files for a capture (images by their keys, fonts under "font:<index>"): data: URLs decode in place;
 * http(s) URLs go through the host's fetcher (the desktop app downloads with the capture window's
 * session, so localhost cookies work), with size and time limits, a soft cutoff and a caller's signal.
 * Anything that fails resolves to null: planImport draws a placeholder for an image and leaves a font
 * to the system.
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
  /** Stops the downloads: running ones abort, and resolveCaptureFiles rejects with the signal's reason. */
  signal?: AbortSignal;
  /** A soft cutoff (Date.now() milliseconds): downloads still running then abort, and files not downloaded yet resolve to null. */
  until?: number;
  /** Called once per file as it resolves ("timed-out": its own timeout or the cutoff stopped it). */
  onFile?(key: string, status: "ok" | "failed" | "timed-out", done: number, total: number): void;
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
  const total = queue.length;
  // Aborts on the caller's signal or at the cutoff: workers stop taking files, and running downloads abort.
  const stop = new AbortController();
  const onStop = () => stop.abort();
  if (options.signal?.aborted) onStop();
  else options.signal?.addEventListener("abort", onStop, { once: true });
  const cutoff = options.until !== undefined ? setTimeout(onStop, Math.max(0, options.until - Date.now())) : undefined;
  let done = 0;
  const finish = (key: string, value: ResolvedImage | null, status: "ok" | "failed" | "timed-out") => {
    out.set(key, value);
    done++;
    try {
      options.onFile?.(key, status, done, total);
    } catch {
      // A progress listener failing never breaks a download.
    }
  };
  const next = () => (stop.signal.aborted ? undefined : queue.shift());
  const worker = async () => {
    for (let item = next(); item; item = next()) {
      const [key, source] = item;
      let got: { bytes: Uint8Array; mime: string } | null = null;
      let timedOut = false;
      if (source.url.startsWith("data:")) got = decodeDataUrl(source.url);
      else if (/^https?:/i.test(source.url) && options.fetch) {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, options.timeoutMs ?? 15_000);
        const signal = AbortSignal.any([controller.signal, stop.signal]);
        try {
          // Race the fetcher as well, so one that ignores its signal can't hold up the queue.
          got = await raceAbort(options.fetch(source.url, signal), signal);
        } catch {
          got = null;
        } finally {
          clearTimeout(timer);
        }
        if (stop.signal.aborted) timedOut = true;
      }
      if (got && got.bytes.byteLength > 0 && got.bytes.byteLength <= maxBytes && got.bytes.byteLength <= budget) {
        budget -= got.bytes.byteLength;
        const resolved: ResolvedImage = { bytes: got.bytes, mime: got.mime || source.mime || "" };
        if (source.width) resolved.width = source.width;
        if (source.height) resolved.height = source.height;
        finish(key, resolved, "ok");
      } else finish(key, null, timedOut ? "timed-out" : "failed");
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 6) }, worker));
  } finally {
    clearTimeout(cutoff);
    options.signal?.removeEventListener("abort", onStop);
  }
  options.signal?.throwIfAborted();
  // Files the cutoff left in the queue resolve to null (placeholders).
  for (const [key] of queue.splice(0)) finish(key, null, "timed-out");
  return out;
}

/** Settle with `promise`, or reject as soon as `signal` aborts. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  promise.catch(() => undefined);
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
