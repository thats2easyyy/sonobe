/** Popup: copy the page, or start the element picker, for pasting into Sonobe. */

/// <reference types="chrome" />

import type { CaptureReply } from "./background.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $<HTMLParagraphElement>("status");
const setStatus = (text: string, tone: "info" | "error" = "info") => {
  status.textContent = text;
  status.dataset.tone = tone;
};

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Ask for other sites' images while there's still a click to ask with. */
async function ensureRemoteAccess(): Promise<void> {
  if (!$<HTMLInputElement>("remote").checked) return;
  await chrome.permissions.request({ origins: ["<all_urls>"] }).catch(() => false);
}

$("page").addEventListener("click", async () => {
  const tab = await activeTab();
  if (tab?.id === undefined) return;
  const button = $<HTMLButtonElement>("page");
  button.disabled = true;
  await ensureRemoteAccess();
  setStatus("Capturing…");
  const reply = (await chrome.runtime.sendMessage({ type: "sonobe-capture-page", tabId: tab.id, fullPage: $<HTMLInputElement>("full").checked })) as CaptureReply;
  button.disabled = false;
  if (!reply.ok) {
    setStatus(reply.message, "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(reply.text);
    setStatus(`Copied: ${reply.summary}. Paste it into Sonobe with ⌘V.`);
  } catch {
    setStatus("Couldn't write to the clipboard. Try again.", "error");
  }
});

$("pick").addEventListener("click", async () => {
  const tab = await activeTab();
  if (tab?.id === undefined) return;
  await ensureRemoteAccess();
  const reply = (await chrome.runtime.sendMessage({ type: "sonobe-pick", tabId: tab.id })) as { ok: boolean; message?: string };
  if (reply.ok) window.close();
  else setStatus(reply.message ?? "Couldn't start the picker on this page.", "error");
});
