/**
 * Captures in Node ("@sonobe/import/node"): render a URL or HTML page in Playwright's Chromium, draw its
 * SF Symbol placeholders with the request's renderer (symbols.ts), run the DOM walker, and download
 * images with the page's cookies. Playwright is optional. It's found at runtime where Sonobe runs (a
 * checkout has it), and hosts explain how to install it when it isn't. One deadline covers the whole
 * capture (run.ts); a cancel or the deadline closes the browser at once.
 */

import type { DesignCapture } from "./capture.ts";
import type { ResolvedImage } from "./convert.ts";
import type { WalkOptions } from "./dom/walk.ts";
import { resolveCaptureFiles } from "./resolve.ts";
import { CAPTURE_BUDGETS, createCaptureRun, IMAGE_CUTOFF_MS, StepTimeoutError, type CaptureControl } from "./run.ts";
import { walkPage, type SymbolRenderer } from "./symbols.ts";

export { symbolHelper } from "./sfsymbol.ts";

export interface PageCaptureRequest {
  url?: string;
  html?: string;
  width: number;
  height: number;
  selector?: string;
  waitFor?: string;
  waitMs?: number;
  fullPage?: boolean;
  colorScheme?: "light" | "dark";
  screenshot?: boolean;
  /** The whole capture's deadline, not counting waitMs. Default 90 s (CAPTURE_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Draws the page's `<svg data-sf-symbol>` placeholders. Without one they stay gray placeholders, with a note. */
  symbols?: SymbolRenderer;
}

export interface PageCaptureResult {
  capture: DesignCapture;
  images: Map<string, ResolvedImage | null>;
  /** PNG of the viewport as the browser drew it, base64. */
  screenshot?: { data: string; width: number; height: number };
  /** What the capture left out (a screenshot that timed out, images cut off by the deadline). */
  notes?: string[];
}

/** Playwright isn't installed where Sonobe runs, or its browser is missing. */
export class CaptureUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureUnavailableError";
  }
}

/** The page couldn't be loaded or captured (a dead dev server, a selector that matched nothing). */
export class CaptureFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureFailedError";
  }
}

interface ChromiumLike {
  launch(options: Record<string, unknown>): Promise<BrowserLike>;
}
interface BrowserLike {
  newContext(options: Record<string, unknown>): Promise<ContextLike>;
  close(): Promise<void>;
}
interface ContextLike {
  newPage(): Promise<PageLike>;
  request: { get(url: string, options: Record<string, unknown>): Promise<{ ok(): boolean; body(): Promise<Buffer>; headers(): Record<string, string> }> };
}
interface PageLike {
  goto(url: string, options: Record<string, unknown>): Promise<unknown>;
  setContent(html: string, options: Record<string, unknown>): Promise<unknown>;
  evaluate<T>(fn: string | ((arg: never) => T), arg?: unknown): Promise<T>;
  screenshot(options: Record<string, unknown>): Promise<Buffer>;
  on(event: string, cb: (arg: { dismiss(): Promise<void> }) => void): void;
}

async function loadChromium(): Promise<ChromiumLike> {
  for (const name of ["playwright", "playwright-core"]) {
    try {
      // A computed specifier keeps bundlers from inlining Playwright: it loads from node_modules at runtime.
      const mod = (await import(name)) as { chromium?: ChromiumLike; default?: { chromium?: ChromiumLike } };
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return chromium;
    } catch {
      // Try the next package.
    }
  }
  throw new CaptureUnavailableError("Rendering pages without the Sonobe app needs Playwright, which isn't installed where Sonobe runs.");
}

const firstLine = (err: unknown) => (err instanceof Error ? err.message.split("\n")[0]! : String(err));

/**
 * Capture a page. Rejects with CaptureTimeoutError (naming the stage) past the deadline and with
 * CaptureCancelledError when control.signal aborts; the browser is closed on every path.
 */
export async function capturePage(request: PageCaptureRequest, control: CaptureControl = {}): Promise<PageCaptureResult> {
  const run = createCaptureRun({
    ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    ...(request.waitMs !== undefined ? { waitMs: request.waitMs } : {}),
    ...(control.signal ? { signal: control.signal } : {}),
    ...(control.onProgress ? { onProgress: control.onProgress } : {}),
  });
  let browser: BrowserLike | undefined;
  const closeBrowser = () => void browser?.close().catch(() => undefined);
  // A cancel or the deadline closes the browser right away, which also ends a page stuck in a loop.
  run.signal.addEventListener("abort", closeBrowser, { once: true });
  try {
    run.report({ stage: "starting", message: "Starting a headless browser" });
    const chromium = await run.step(loadChromium());
    const launching = chromium.launch({ args: ["--mute-audio"], timeout: CAPTURE_BUDGETS.launch });
    // A browser that starts after the run gave up is closed as soon as it exists.
    launching.then((b) => {
      browser = b;
      if (run.signal.aborted) closeBrowser();
    }, () => undefined);
    try {
      browser = await run.step(launching);
    } catch (err) {
      run.throwIfAborted();
      throw new CaptureUnavailableError(`Playwright couldn't start Chromium (${firstLine(err)}). Run: npx playwright install chromium`);
    }
    const context = await run.step(browser.newContext({ viewport: { width: request.width, height: request.height }, deviceScaleFactor: 1, colorScheme: request.colorScheme ?? "light", serviceWorkers: "block", acceptDownloads: false }));
    const page = await run.step(context.newPage());
    page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));

    run.report({ stage: "loading", message: request.url ? `Loading ${request.url}` : "Rendering the HTML" });
    try {
      const load = request.url ? page.goto(request.url, { waitUntil: "load", timeout: CAPTURE_BUDGETS.load }) : page.setContent(request.html ?? "", { waitUntil: "load", timeout: CAPTURE_BUDGETS.load });
      await run.step(load);
    } catch (err) {
      run.throwIfAborted();
      throw new CaptureFailedError(request.url ? `Couldn't load ${request.url}: ${firstLine(err)}` : `Couldn't render the HTML: ${firstLine(err)}`);
    }

    run.report({ stage: "walking", message: request.waitFor ? `Waiting for ${request.waitFor}, then reading the page's layers` : "Reading the page's layers" });
    const walkBudget = CAPTURE_BUDGETS.walk + (request.waitMs ?? 0);
    const walkOptions: WalkOptions = {
      ...(request.selector ? { selector: request.selector } : {}),
      ...(request.waitFor ? { waitFor: request.waitFor } : {}),
      ...(request.waitMs ? { waitMs: request.waitMs } : {}),
      ...(request.fullPage === false ? { fullPage: false } : {}),
      source: request.url ? { kind: "url", url: request.url, generator: "sonobe-walker/1" } : { kind: "html", generator: "sonobe-walker/1" },
    };
    let capture: DesignCapture;
    const notes: string[] = [];
    try {
      // evaluate runs outside the page's Content Security Policy, unlike a script tag.
      const walked = await walkPage((script) => page.evaluate(script), { run, walk: walkOptions, ...(request.symbols ? { symbols: request.symbols } : {}) });
      capture = walked.capture;
      notes.push(...walked.notes);
    } catch (err) {
      run.throwIfAborted();
      if (err instanceof StepTimeoutError) throw new CaptureFailedError(`The page didn't answer within ${Math.round(walkBudget / 1000)} seconds (it may be busy or stuck in a loop).`);
      throw new CaptureFailedError(err instanceof Error ? err.message.replace(/^.*?Error: /s, "").split("\n")[0]! : String(err));
    }
    if (request.url && capture.source.title === undefined) {
      const title = await run.step(page.evaluate<string>("document.title"), 5_000).catch(() => "");
      run.throwIfAborted();
      if (title) capture.source.title = title;
    }

    const files = Object.keys(capture.images).length + (capture.fonts?.length ?? 0);
    if (files) run.report({ stage: "images", message: `Downloading images: 0 of ${files}`, done: 0, total: files });
    let late = 0;
    const images = await run.step(
      resolveCaptureFiles(capture, {
        fetch: async (url, signal) => {
          const response = await context.request.get(url, { timeout: 15_000, failOnStatusCode: false });
          if (signal.aborted || !response.ok()) return null;
          return { bytes: new Uint8Array(await response.body()), mime: response.headers()["content-type"] ?? "" };
        },
        signal: run.signal,
        until: run.deadline - IMAGE_CUTOFF_MS,
        onFile: (_key, status, done, total) => {
          if (status === "timed-out") late++;
          run.report({ stage: "images", message: `Downloading images: ${done} of ${total}`, done, total });
        },
      }),
    );
    if (late) notes.push(`${late === 1 ? "1 image or font" : `${late} images or fonts`} didn't download in time, so ${late === 1 ? "it shows" : "they show"} as a placeholder or an installed font.`);
    const result: PageCaptureResult = { capture, images };
    if (request.screenshot) {
      run.report({ stage: "screenshot", message: "Taking the page screenshot" });
      try {
        const png = await run.step(page.screenshot({ type: "png", timeout: CAPTURE_BUDGETS.screenshot }), CAPTURE_BUDGETS.screenshot);
        result.screenshot = { data: Buffer.from(png).toString("base64"), width: request.width, height: request.height };
      } catch (err) {
        run.throwIfAborted();
        // The layers are what matter: a missing screenshot is a note, not a failed import.
        notes.push(`The page screenshot is left out (${err instanceof StepTimeoutError ? "it timed out" : firstLine(err)}). Compare with get_screenshot instead.`);
      }
    }
    if (notes.length) result.notes = notes;
    return result;
  } finally {
    run.signal.removeEventListener("abort", closeBrowser);
    run.dispose();
    if (browser) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([browser.close().catch(() => undefined), new Promise((resolve) => (timer = setTimeout(resolve, 5_000)))]);
      clearTimeout(timer);
    }
  }
}
