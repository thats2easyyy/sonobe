/**
 * Design capture for import_design and the editor's Import dialog: render a URL or an HTML page in a
 * hidden, sandboxed window (no preload, no Node, its own session), run the DOM walker from
 * @sonobe/import in it, download the page's images with that session (so a dev server's cookies
 * and auth work), and optionally screenshot the page as drawn.
 *
 * The page is untrusted: it runs with Chromium's sandbox and web security, can't open windows, ask for
 * permissions, download files, or navigate anywhere but http(s), and its window is destroyed afterwards.
 *
 * One deadline covers the whole capture (createCaptureRun), and every await runs through it, so a
 * page stuck in a loop, a debugger command that never answers or a screenshot that stalls ends in an
 * error naming the stage. A cancel or the deadline destroys the window at once, which also settles
 * whatever was still waiting on it.
 */

import { BrowserWindow, session as electronSession, type Session } from "electron";
import {
  CAPTURE_BUDGETS,
  CAPTURE_TIMEOUT_MS,
  CaptureCancelledError,
  CaptureTimeoutError,
  createCaptureRun,
  IMAGE_CUTOFF_MS,
  resolveCaptureFiles,
  StepTimeoutError,
  WALKER_SOURCE,
  type CaptureProgress,
  type DesignCapture,
  type ResolvedImage,
} from "@sonobe/import";
import { HostError, type CapturedDesign, type DesignCaptureRequest } from "@sonobe/mcp";

/** Captures share cookies and storage with each other, never with the editor. */
export const CAPTURE_PARTITION = "persist:sonobe-capture";

const MAX_HTML_BYTES = 1_500_000;

let preparedSession: Session | null = null;

function captureSession(): Session {
  if (preparedSession) return preparedSession;
  const ses = electronSession.fromPartition(CAPTURE_PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on("will-download", (event) => event.preventDefault());
  preparedSession = ses;
  return ses;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A readable reason for a failed load ("ERR_CONNECTION_REFUSED" → nothing is listening). */
export function loadFailureHint(message: string, url: string | undefined): string {
  if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE/.test(message)) return `Nothing answered at ${url}. Start the app's dev server (npm run dev, or the project's own command), then import again.`;
  if (/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(message)) return "Check the address and the network connection.";
  if (/ERR_CERT/.test(message)) return "The site's certificate isn't trusted. Use the dev server's http:// address instead.";
  return "Check that the address opens in a browser.";
}

export interface DesignCaptureOptions {
  log?(level: "info" | "warn", message: string): void;
  /** Cancels the capture: the window is destroyed at once and the call rejects with HostError "cancelled". */
  signal?: AbortSignal;
  onProgress?(progress: CaptureProgress): void;
  /** The longest deadline a capture may have, not counting waitMs (default 90 s; test runs lower it). */
  maxTimeoutMs?: number;
}

/** Captures running now, so quitting the app can end them. */
const running = new Set<AbortController>();

/** Cancel every running capture (the app is quitting). */
export function abortCaptures(): void {
  for (const controller of running) controller.abort();
}

export async function captureDesignInWindow(request: DesignCaptureRequest, options: DesignCaptureOptions = {}): Promise<CapturedDesign> {
  if (request.url !== undefined && !/^https?:\/\//i.test(request.url)) throw new HostError("invalid_url", `"${request.url}" isn't an http(s) address.`, { hint: "Pass the dev server's address, like http://localhost:3000/settings." });
  if (request.html !== undefined && Buffer.byteLength(request.html) > MAX_HTML_BYTES) throw new HostError("html_too_large", "That HTML is larger than 1.5 MB.", { hint: "Import one screen at a time, and reference large images by URL instead of embedding them." });
  const width = Math.max(100, Math.min(4000, Math.round(request.width)));
  const height = Math.max(100, Math.min(8000, Math.round(request.height)));
  const maxTimeoutMs = options.maxTimeoutMs ?? CAPTURE_TIMEOUT_MS;
  const quitting = new AbortController();
  running.add(quitting);
  const run = createCaptureRun({
    timeoutMs: Math.min(request.timeoutMs ?? maxTimeoutMs, maxTimeoutMs),
    ...(request.waitMs !== undefined ? { waitMs: request.waitMs } : {}),
    signal: options.signal ? AbortSignal.any([options.signal, quitting.signal]) : quitting.signal,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
  const ses = captureSession();
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    frame: false,
    skipTaskbar: true,
    enableLargerThanScreen: true,
    paintWhenInitiallyHidden: true,
    webPreferences: { partition: CAPTURE_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, navigateOnDragDrop: false, spellcheck: false, disableDialogs: true, autoplayPolicy: "document-user-activation-required" },
  });
  const wc = win.webContents;
  // Detaching and destroying settles debugger commands still waiting and ends a renderer stuck in a loop.
  const destroy = () => {
    try {
      if (!wc.isDestroyed() && wc.debugger.isAttached()) wc.debugger.detach();
    } catch {
      // Already detached.
    }
    if (!win.isDestroyed()) win.destroy();
  };
  run.signal.addEventListener("abort", destroy, { once: true });
  const notes: string[] = [];
  try {
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (event, url) => {
      if (!/^https?:/i.test(url)) event.preventDefault();
    });
    wc.on("will-attach-webview", (event) => event.preventDefault());

    if (request.colorScheme) {
      run.report({ stage: "color-scheme", message: `Switching the page to ${request.colorScheme} mode` });
      try {
        // A new window has no renderer until its first navigation, and CDP's Emulation domain is handled
        // in the renderer: a command sent before then waits for one, and loadURL (below) waited for the
        // command, so the capture deadlocked. about:blank starts a renderer first. The emulation then
        // holds across later navigations, cross-site ones too, for as long as the debugger stays attached.
        await run.step(wc.loadURL("about:blank"), CAPTURE_BUDGETS.colorScheme);
        wc.debugger.attach("1.3");
        await run.step(wc.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: request.colorScheme }] }), CAPTURE_BUDGETS.colorScheme);
      } catch (err) {
        run.throwIfAborted();
        options.log?.("warn", `Couldn't set the color scheme for a design capture: ${err instanceof StepTimeoutError ? "no answer" : errorText(err)}`);
        notes.push(`The page rendered in its default color scheme: Sonobe couldn't switch it to ${request.colorScheme}.`);
      }
    }

    run.report({ stage: "loading", message: request.url ? `Loading ${request.url}` : "Rendering the HTML" });
    const target = request.url ?? `data:text/html;charset=utf-8;base64,${Buffer.from(request.html ?? "").toString("base64")}`;
    try {
      await run.step(wc.loadURL(target), CAPTURE_BUDGETS.load);
    } catch (err) {
      run.throwIfAborted();
      const message = err instanceof StepTimeoutError ? "ERR_TIMED_OUT" : errorText(err);
      // A redirect or a client-side navigation aborts the first load, but the page still arrives.
      if (!/ERR_ABORTED/.test(message) || !/^(?:https?|data):/.test(wc.getURL())) {
        throw new HostError("capture_failed", request.url ? `Couldn't load ${request.url} (${message.replace(/^.*?(ERR_[A-Z_]+).*$/s, "$1")}).` : `Couldn't render the HTML (${message}).`, { hint: loadFailureHint(message, request.url) });
      }
    }

    run.report({ stage: "walking", message: request.waitFor ? `Waiting for ${request.waitFor}, then reading the page's layers` : "Reading the page's layers" });
    const walkBudget = CAPTURE_BUDGETS.walk + (request.waitMs ?? 0);
    const walk = {
      ...(request.selector ? { selector: request.selector } : {}),
      ...(request.waitFor ? { waitFor: request.waitFor } : {}),
      ...(request.waitMs ? { waitMs: request.waitMs } : {}),
      ...(request.fullPage === false ? { fullPage: false } : {}),
      source: request.url ? { kind: "url", url: request.url, generator: "sonobe-walker/1" } : { kind: "html", generator: "sonobe-walker/1" },
    };
    let capture: DesignCapture;
    try {
      // executeJavaScript runs outside the page's Content Security Policy. A page stuck in a loop never
      // answers; the window is destroyed either way, and its pending calls are left behind.
      const walked = (async () => {
        await wc.executeJavaScript(WALKER_SOURCE, true);
        return (await wc.executeJavaScript(`window.__sonobeCapture(${JSON.stringify(walk)})`, true)) as DesignCapture;
      })();
      capture = await run.step(walked, walkBudget);
    } catch (err) {
      run.throwIfAborted();
      const message = err instanceof StepTimeoutError ? `The page didn't answer within ${Math.round(walkBudget / 1000)} seconds (it may be busy or stuck in a loop).` : errorText(err).replace(/^Error: /, "");
      throw new HostError("capture_failed", `Couldn't capture the page: ${message}`, { hint: request.selector ? `Check that "${request.selector}" matches an element on the page.` : "Try waitFor with a selector that appears once the screen has loaded." });
    }
    if (request.url && !capture.source.title) {
      const title = wc.getTitle();
      if (title && !/^https?:/.test(title)) capture.source.title = title;
    }

    const files = Object.keys(capture.images).length + (capture.fonts?.length ?? 0);
    if (files) run.report({ stage: "images", message: `Downloading images: 0 of ${files}`, done: 0, total: files });
    let late = 0;
    const images: Map<string, ResolvedImage | null> = await run.step(
      resolveCaptureFiles(capture, {
        fetch: async (url, signal) => {
          const response = await ses.fetch(url, { signal });
          if (!response.ok) return null;
          return { bytes: new Uint8Array(await response.arrayBuffer()), mime: response.headers.get("content-type") ?? "" };
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

    const out: CapturedDesign = { capture, images };
    if (request.screenshot) {
      run.report({ stage: "screenshot", message: "Taking the page screenshot" });
      try {
        const image = await run.step(wc.capturePage(undefined, { stayHidden: true }), CAPTURE_BUDGETS.screenshot);
        if (!image.isEmpty()) {
          const sized = image.resize({ width, quality: "best" });
          const size = sized.getSize();
          out.screenshot = { data: sized.toPNG().toString("base64"), mimeType: "image/png", width: size.width, height: size.height };
        }
      } catch (err) {
        run.throwIfAborted();
        // The layers are what matter: a missing screenshot is a note, not a failed import.
        notes.push(`The page screenshot is left out (${err instanceof StepTimeoutError ? "it timed out" : errorText(err)}). Compare with get_screenshot instead.`);
      }
    }
    if (notes.length) out.notes = notes;
    return out;
  } catch (err) {
    if (err instanceof CaptureTimeoutError || err instanceof CaptureCancelledError) throw new HostError(err.code, err.message, { hint: err.hint });
    throw err;
  } finally {
    run.signal.removeEventListener("abort", destroy);
    run.dispose();
    running.delete(quitting);
    destroy();
  }
}

/** Download an image with the capture session (for captures made outside the app). */
export async function fetchCaptureImage(url: string, signal: AbortSignal): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!/^https?:/i.test(url)) return null;
  const response = await captureSession().fetch(url, { signal });
  if (!response.ok) return null;
  return { bytes: new Uint8Array(await response.arrayBuffer()), mime: response.headers.get("content-type") ?? "" };
}
