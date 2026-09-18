/**
 * Sonobe Capture service worker: runs the DOM walker from @sonobe/import in a tab (in the page's own
 * world, so React and Vue component names come through), downloads images other sites serve when the
 * person allowed it, and copies the design capture to the clipboard for pasting into Sonobe.
 */

/// <reference types="chrome" />

import type { DesignCapture } from "@sonobe/import";

export interface CaptureRequest {
  /** Capture the element the picker marked instead of the page. */
  picked?: boolean;
  fullPage?: boolean;
}

export type CaptureReply = { ok: true; text: string; summary: string } | { ok: false; message: string };

const PICKED = "[data-sonobe-capture-target]";

async function runWalker(tabId: number, request: CaptureRequest): Promise<DesignCapture> {
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["walker.js"] });
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [{ ...(request.picked ? { selector: PICKED } : {}), ...(request.fullPage === false ? { fullPage: false } : {}), inlineImages: "all", settleMs: 150, timeoutMs: 8000 }],
    func: async (options: Record<string, unknown>) => {
      const capture = (window as unknown as { __sonobeCapture(o: unknown): Promise<unknown> }).__sonobeCapture({ ...options, source: { kind: "chrome", url: location.href, title: document.title, generator: "sonobe-chrome/0.1.0" } });
      try {
        return { ok: true, json: JSON.stringify(await capture) };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  });
  const value = result?.result as { ok: true; json: string } | { ok: false; message: string } | undefined;
  if (!value) throw new Error("Chrome didn't run the capture on this page.");
  if (!value.ok) throw new Error(value.message);
  return JSON.parse(value.json) as DesignCapture;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Embed images and fonts the page couldn't read itself (other sites without CORS), when allowed. */
async function embedRemoteFiles(capture: DesignCapture): Promise<number> {
  const allowed = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  const sources: { url: string; mime?: string }[] = [...Object.values(capture.images), ...(capture.fonts ?? [])];
  let missing = 0;
  await Promise.all(
    sources.map(async (source) => {
      if (!/^https?:/i.test(source.url)) return;
      if (!allowed) {
        missing++;
        return;
      }
      try {
        // No cookies, and only images and fonts: the page chooses these URLs, so they mustn't pull
        // signed-in content from other sites onto the clipboard.
        const response = await fetch(source.url, { credentials: "omit" });
        const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
        if (!response.ok || !/^(?:image\/|font\/|application\/(?:font|x-font|vnd\.ms-fontobject))/.test(mime)) throw new Error("unusable");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > 25 * 1024 * 1024) throw new Error("unusable");
        source.url = `data:${mime};base64,${toBase64(bytes)}`;
        source.mime = mime;
      } catch {
        missing++;
      }
    }),
  );
  return missing;
}

function summarize(capture: DesignCapture, missing: number): string {
  const images = Object.keys(capture.images).length;
  const parts = [`${capture.stats?.nodes ?? 0} layers`, `${images} image${images === 1 ? "" : "s"}`];
  if (missing) parts.push(`${missing} linked, not embedded`);
  return parts.join(" · ");
}

export async function captureTab(tabId: number, request: CaptureRequest = {}): Promise<CaptureReply> {
  try {
    const capture = await runWalker(tabId, request);
    const missing = await embedRemoteFiles(capture);
    const text = JSON.stringify(capture);
    (globalThis as { __lastCapture?: string }).__lastCapture = text;
    return { ok: true, text, summary: summarize(capture, missing) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: /Cannot access|chrome:\/\/|webstore/i.test(message) ? "Chrome doesn't let extensions read this page (browser pages and the Web Store). Open a website or your app's dev server." : message };
  }
}

/** Write text to the clipboard from an offscreen document (a service worker has no clipboard). */
async function copyToClipboard(text: string): Promise<void> {
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: [chrome.offscreen.Reason.CLIPBOARD], justification: "Copy the captured design so it can be pasted into Sonobe." });
  }
  const reply = (await chrome.runtime.sendMessage({ type: "sonobe-offscreen-copy", text })) as { ok: boolean } | undefined;
  if (!reply?.ok) throw new Error("Couldn't write to the clipboard.");
}

export async function startPicker(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["picker.js"] });
}

chrome.runtime.onMessage.addListener((message: { type?: string; tabId?: number; fullPage?: boolean }, sender, sendResponse) => {
  if (message.type === "sonobe-capture-page" && typeof message.tabId === "number") {
    void captureTab(message.tabId, { fullPage: message.fullPage !== false }).then(sendResponse);
    return true;
  }
  if (message.type === "sonobe-pick" && typeof message.tabId === "number") {
    void startPicker(message.tabId).then(() => sendResponse({ ok: true }), (err: unknown) => sendResponse({ ok: false, message: String(err) }));
    return true;
  }
  if (message.type === "sonobe-picked" && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    void captureTab(tabId, { picked: true, fullPage: false }).then(async (reply) => {
      if (reply.ok) {
        try {
          await copyToClipboard(reply.text);
          sendResponse({ ok: true, summary: reply.summary });
        } catch (err) {
          sendResponse({ ok: false, message: err instanceof Error ? err.message : String(err) });
        }
      } else sendResponse(reply);
    });
    return true;
  }
  return false;
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "pick-element" && tab?.id !== undefined) void startPicker(tab.id);
});

Object.assign(globalThis, { captureTab, startPicker });
