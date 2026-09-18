/**
 * Design capture for import_design and the editor's Import dialog: render a URL or an HTML page in a
 * hidden, sandboxed window (no preload, no Node, its own session), run the DOM walker from
 * @sonobe/import in it, download the page's images with that session (so a dev server's cookies
 * and auth work), and optionally screenshot the page as drawn.
 *
 * The page is untrusted: it runs with Chromium's sandbox and web security, can't open windows, ask for
 * permissions, download files, or navigate anywhere but http(s), and its window is destroyed afterwards.
 */

import { BrowserWindow, session as electronSession, type Session } from "electron";
import { resolveCaptureFiles, WALKER_SOURCE, type DesignCapture, type ResolvedImage } from "@sonobe/import";
import { HostError, type CapturedDesign, type DesignCaptureRequest } from "@sonobe/mcp";

/** Captures share cookies and storage with each other, never with the editor. */
export const CAPTURE_PARTITION = "persist:sonobe-capture";

const LOAD_TIMEOUT_MS = 30_000;
const CAPTURE_TIMEOUT_MS = 45_000;
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

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(onTimeout()), ms);
    }),
  ]);
}

/** A readable reason for a failed load ("ERR_CONNECTION_REFUSED" → nothing is listening). */
export function loadFailureHint(message: string, url: string | undefined): string {
  if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE/.test(message)) return `Nothing answered at ${url}. Start the app's dev server (npm run dev, or the project's own command), then import again.`;
  if (/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(message)) return "Check the address and the network connection.";
  if (/ERR_CERT/.test(message)) return "The site's certificate isn't trusted. Use the dev server's http:// address instead.";
  return "Check that the address opens in a browser.";
}

export interface DesignCaptureOptions {
  log?(level: "info" | "warn", message: string): void;
}

export async function captureDesignInWindow(request: DesignCaptureRequest, options: DesignCaptureOptions = {}): Promise<CapturedDesign> {
  if (request.url !== undefined && !/^https?:\/\//i.test(request.url)) throw new HostError("invalid_url", `"${request.url}" isn't an http(s) address.`, { hint: "Pass the dev server's address, like http://localhost:3000/settings." });
  if (request.html !== undefined && Buffer.byteLength(request.html) > MAX_HTML_BYTES) throw new HostError("html_too_large", "That HTML is larger than 1.5 MB.", { hint: "Import one screen at a time, and reference large images by URL instead of embedding them." });
  const width = Math.max(100, Math.min(4000, Math.round(request.width)));
  const height = Math.max(100, Math.min(8000, Math.round(request.height)));
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
  try {
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (event, url) => {
      if (!/^https?:/i.test(url)) event.preventDefault();
    });
    wc.on("will-attach-webview", (event) => event.preventDefault());
    if (request.colorScheme) {
      try {
        wc.debugger.attach("1.3");
        await wc.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: request.colorScheme }] });
      } catch (err) {
        options.log?.("warn", `Couldn't set the color scheme for a design capture: ${errorText(err)}`);
      }
    }

    const target = request.url ?? `data:text/html;charset=utf-8;base64,${Buffer.from(request.html ?? "").toString("base64")}`;
    try {
      await withTimeout(wc.loadURL(target), LOAD_TIMEOUT_MS, () => new Error("ERR_TIMED_OUT"));
    } catch (err) {
      const message = errorText(err);
      // A redirect or a client-side navigation aborts the first load, but the page still arrives.
      if (!/ERR_ABORTED/.test(message) || !/^(?:https?|data):/.test(wc.getURL())) {
        throw new HostError("capture_failed", request.url ? `Couldn't load ${request.url} (${message.replace(/^.*?(ERR_[A-Z_]+).*$/s, "$1")}).` : `Couldn't render the HTML (${message}).`, { hint: loadFailureHint(message, request.url) });
      }
    }

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
      // answers, so both calls share one deadline, and the window is destroyed either way.
      const run = async () => {
        await wc.executeJavaScript(WALKER_SOURCE, true);
        return (await wc.executeJavaScript(`window.__sonobeCapture(${JSON.stringify(walk)})`, true)) as DesignCapture;
      };
      capture = await withTimeout(run(), CAPTURE_TIMEOUT_MS, () => new Error("The page didn't answer within 45 seconds (it may be busy or stuck in a loop)."));
    } catch (err) {
      const message = errorText(err).replace(/^Error: /, "");
      throw new HostError("capture_failed", `Couldn't capture the page: ${message}`, { hint: request.selector ? `Check that "${request.selector}" matches an element on the page.` : "Try waitFor with a selector that appears once the screen has loaded." });
    }
    if (request.url && !capture.source.title) {
      const title = wc.getTitle();
      if (title && !/^https?:/.test(title)) capture.source.title = title;
    }

    const images: Map<string, ResolvedImage | null> = await resolveCaptureFiles(capture, {
      fetch: async (url, signal) => {
        const response = await ses.fetch(url, { signal });
        if (!response.ok) return null;
        return { bytes: new Uint8Array(await response.arrayBuffer()), mime: response.headers.get("content-type") ?? "" };
      },
    });

    const out: CapturedDesign = { capture, images };
    if (request.screenshot) {
      const image = await wc.capturePage(undefined, { stayHidden: true });
      if (!image.isEmpty()) {
        const sized = image.resize({ width, quality: "best" });
        const size = sized.getSize();
        out.screenshot = { data: sized.toPNG().toString("base64"), mimeType: "image/png", width: size.width, height: size.height };
      }
    }
    return out;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/** Download an image with the capture session (for captures made outside the app). */
export async function fetchCaptureImage(url: string, signal: AbortSignal): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!/^https?:/i.test(url)) return null;
  const response = await captureSession().fetch(url, { signal });
  if (!response.ok) return null;
  return { bytes: new Uint8Array(await response.arrayBuffer()), mime: response.headers.get("content-type") ?? "" };
}
