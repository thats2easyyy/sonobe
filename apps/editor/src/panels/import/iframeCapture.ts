/**
 * Capture HTML in the browser editor: render it in a sandboxed iframe (scripts on, but an opaque origin,
 * so the page can't reach the editor), run the DOM walker inside, and receive the capture by
 * postMessage. The desktop app renders pages in its own hidden window instead (sonobeHost.captureDesign).
 */

import { WALKER_SOURCE, type DesignCapture } from "@sonobe/import";

export interface IframeCaptureRequest {
  html: string;
  width: number;
  height: number;
  selector?: string;
  waitFor?: string;
  waitMs?: number;
  fullPage?: boolean;
  timeoutMs?: number;
  /** Removes the iframe and rejects with the signal's reason. */
  signal?: AbortSignal;
}

const MESSAGE = "sonobe-design-capture";

/** The page with the walker appended, reporting to its parent. */
export function withCaptureScript(html: string, nonce: string, options: Record<string, unknown>): string {
  const script = `<script>${WALKER_SOURCE.replace(/<\/script/gi, "<\\/script")}
;window.__sonobeCapture(${JSON.stringify(options).replace(/</g, "\\u003c")}).then(function (capture) {
  parent.postMessage({ type: ${JSON.stringify(MESSAGE)}, nonce: ${JSON.stringify(nonce)}, capture: capture }, "*");
}, function (err) {
  parent.postMessage({ type: ${JSON.stringify(MESSAGE)}, nonce: ${JSON.stringify(nonce)}, error: String((err && err.message) || err) }, "*");
});</script>`;
  return /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i, `${script}</body>`) : `${html}${script}`;
}

export function captureHtmlInIframe(request: IframeCaptureRequest, doc: Document = document): Promise<DesignCapture> {
  const nonce = Math.random().toString(36).slice(2);
  const iframe = doc.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.cssText = `position:fixed;left:-20000px;top:0;width:${request.width}px;height:${request.height}px;border:0;visibility:visible;pointer-events:none;`;
  const options = {
    ...(request.selector ? { selector: request.selector } : {}),
    ...(request.waitFor ? { waitFor: request.waitFor } : {}),
    ...(request.waitMs ? { waitMs: request.waitMs } : {}),
    ...(request.fullPage === false ? { fullPage: false } : {}),
    inlineImages: "all",
    source: { kind: "html", generator: "sonobe-walker/1" },
  };
  return new Promise<DesignCapture>((resolve, reject) => {
    const signal = request.signal;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const win = doc.defaultView ?? window;
    const cleanup = () => {
      clearTimeout(timer);
      win.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      iframe.remove();
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; nonce?: unknown; capture?: DesignCapture; error?: unknown } | null;
      if (event.source !== iframe.contentWindow || !data || data.type !== MESSAGE || data.nonce !== nonce) return;
      cleanup();
      if (data.capture) resolve(data.capture);
      else reject(new Error(typeof data.error === "string" ? data.error : "The page couldn't be captured."));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("The page didn't finish loading within 45 seconds."));
    }, request.timeoutMs ?? 45_000);
    win.addEventListener("message", onMessage);
    iframe.srcdoc = withCaptureScript(request.html, nonce, options);
    doc.body.appendChild(iframe);
  });
}
