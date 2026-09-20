import { describe, expect, it, vi } from "vitest";
import type { DesignCapture } from "./capture.ts";
import { resolveCaptureFiles, type ImageFetcher } from "./resolve.ts";

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

function captureWith(urls: string[]): DesignCapture {
  return {
    format: "sonobe.design-capture",
    version: 1,
    source: { kind: "html" },
    viewport: { width: 402, height: 874 },
    root: { kind: "frame", name: "Screen", box: [0, 0, 402, 874], children: [] },
    images: Object.fromEntries(urls.map((url, i) => [`img${i}`, { url }])),
  };
}

const bytes = { bytes: new Uint8Array([1, 2, 3]), mime: "image/png" };

/** A fetcher whose downloads finish only when released, recording the signals it got. */
function heldFetcher() {
  const signals: AbortSignal[] = [];
  const release: (() => void)[] = [];
  const fetch: ImageFetcher = (_url, signal) => {
    signals.push(signal);
    return new Promise((resolve) => release.push(() => resolve(bytes)));
  };
  return { fetch, signals, release };
}

describe("resolveCaptureFiles", () => {
  it("reports every file with a running count", async () => {
    const onFile = vi.fn();
    const images = await resolveCaptureFiles(captureWith([PIXEL, "http://x/a.png", "http://x/missing.png"]), {
      fetch: async (url) => (url.endsWith("a.png") ? bytes : null),
      onFile,
    });
    expect([...images.values()].filter(Boolean)).toHaveLength(2);
    expect(onFile).toHaveBeenCalledTimes(3);
    expect(onFile.mock.calls.map((c) => c[2])).toEqual([1, 2, 3]);
    expect(onFile.mock.calls.every((c) => c[3] === 3)).toBe(true);
    expect(onFile.mock.calls.find((c) => c[0] === "img2")?.[1]).toBe("failed");
  });

  it("aborts running downloads and stops the queue when the signal aborts", async () => {
    const held = heldFetcher();
    const controller = new AbortController();
    const urls = Array.from({ length: 10 }, (_, i) => `http://x/${i}.png`);
    const resolving = resolveCaptureFiles(captureWith(urls), { fetch: held.fetch, signal: controller.signal, concurrency: 2 });
    await new Promise((r) => setTimeout(r, 5));
    expect(held.signals).toHaveLength(2);
    controller.abort(new Error("the person cancelled"));
    await expect(resolving).rejects.toThrow("the person cancelled");
    expect(held.signals.every((s) => s.aborted)).toBe(true);
    // Nothing else started after the abort.
    expect(held.signals).toHaveLength(2);
  });

  it("turns what's left at the cutoff into placeholders, even when a fetcher ignores its signal", async () => {
    const held = heldFetcher();
    const onFile = vi.fn();
    const urls = Array.from({ length: 5 }, (_, i) => `http://x/${i}.png`);
    const resolving = resolveCaptureFiles(captureWith(urls), { fetch: held.fetch, until: Date.now() + 30, concurrency: 2, onFile });
    await new Promise((r) => setTimeout(r, 5));
    held.release[0]!();
    const images = await resolving;
    expect(images.size).toBe(5);
    expect([...images.values()].filter(Boolean)).toHaveLength(1);
    const statuses = onFile.mock.calls.map((c) => c[1]);
    expect(statuses.filter((s) => s === "ok")).toHaveLength(1);
    expect(statuses.filter((s) => s === "timed-out")).toHaveLength(4);
    expect(onFile.mock.calls.at(-1)?.[2]).toBe(5);
  });
});
