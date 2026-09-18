/**
 * Captures in Node ("@sonobe/import/node"): render a URL or HTML page in Playwright's Chromium, run the
 * DOM walker, and download images with the page's cookies. Playwright is optional. It's found at
 * runtime where Sonobe runs (a checkout has it), and hosts explain how to install it when it isn't.
 */

import type { DesignCapture } from "./capture.ts";
import type { ResolvedImage } from "./convert.ts";
import { WALKER_SOURCE } from "./dom/walkerSource.ts";
import type { WalkOptions } from "./dom/walk.ts";
import { resolveCaptureFiles } from "./resolve.ts";

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
  /** Longest wait for the page to load and settle. Default 30 s. */
  timeoutMs?: number;
}

export interface PageCaptureResult {
  capture: DesignCapture;
  images: Map<string, ResolvedImage | null>;
  /** PNG of the viewport as the browser drew it, base64. */
  screenshot?: { data: string; width: number; height: number };
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

export async function capturePage(request: PageCaptureRequest): Promise<PageCaptureResult> {
  const chromium = await loadChromium();
  let browser: BrowserLike;
  try {
    browser = await chromium.launch({ args: ["--mute-audio"] });
  } catch (err) {
    throw new CaptureUnavailableError(`Playwright couldn't start Chromium (${err instanceof Error ? err.message.split("\n")[0] : String(err)}). Run: npx playwright install chromium`);
  }
  const timeout = request.timeoutMs ?? 30_000;
  try {
    const context = await browser.newContext({ viewport: { width: request.width, height: request.height }, deviceScaleFactor: 1, colorScheme: request.colorScheme ?? "light", serviceWorkers: "block", acceptDownloads: false });
    const page = await context.newPage();
    page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
    try {
      if (request.url) await page.goto(request.url, { waitUntil: "load", timeout });
      else await page.setContent(request.html ?? "", { waitUntil: "load", timeout });
    } catch (err) {
      const reason = err instanceof Error ? err.message.split("\n")[0]! : String(err);
      throw new CaptureFailedError(request.url ? `Couldn't load ${request.url}: ${reason}` : `Couldn't render the HTML: ${reason}`);
    }
    const deadline = <T>(promise: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CaptureFailedError("The page didn't answer within 45 seconds (it may be busy or stuck in a loop).")), 45_000);
      });
      return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
    };
    // evaluate runs outside the page's Content Security Policy, unlike a script tag.
    await deadline(page.evaluate(WALKER_SOURCE));
    const options: WalkOptions = {
      ...(request.selector ? { selector: request.selector } : {}),
      ...(request.waitFor ? { waitFor: request.waitFor } : {}),
      ...(request.waitMs ? { waitMs: request.waitMs } : {}),
      ...(request.fullPage === false ? { fullPage: false } : {}),
      source: request.url ? { kind: "url", url: request.url, generator: "sonobe-walker/1" } : { kind: "html", generator: "sonobe-walker/1" },
    };
    let capture: DesignCapture;
    try {
      capture = await deadline(page.evaluate((o: never) => (window as unknown as { __sonobeCapture(o: unknown): Promise<DesignCapture> }).__sonobeCapture(o), options));
    } catch (err) {
      if (err instanceof CaptureFailedError) throw err;
      throw new CaptureFailedError(err instanceof Error ? err.message.replace(/^.*?Error: /s, "").split("\n")[0]! : String(err));
    }
    if (request.url && capture.source.title === undefined) {
      const title = await page.evaluate<string>("document.title");
      if (title) capture.source.title = title;
    }
    const images = await resolveCaptureFiles(capture, {
      fetch: async (url, signal) => {
        const response = await context.request.get(url, { timeout: 15_000, failOnStatusCode: false });
        if (signal.aborted || !response.ok()) return null;
        return { bytes: new Uint8Array(await response.body()), mime: response.headers()["content-type"] ?? "" };
      },
    });
    const result: PageCaptureResult = { capture, images };
    if (request.screenshot) {
      const png = await page.screenshot({ type: "png" });
      result.screenshot = { data: Buffer.from(png).toString("base64"), width: request.width, height: request.height };
    }
    return result;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
