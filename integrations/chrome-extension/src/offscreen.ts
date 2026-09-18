/** Offscreen document: the only place a Manifest V3 extension can write the clipboard without a visible page. */

/// <reference types="chrome" />

chrome.runtime.onMessage.addListener((message: { type?: string; text?: string }, _sender, sendResponse) => {
  if (message.type !== "sonobe-offscreen-copy" || typeof message.text !== "string") return false;
  const area = document.getElementById("text") as HTMLTextAreaElement;
  area.value = message.text;
  area.select();
  const ok = document.execCommand("copy");
  area.value = "";
  sendResponse({ ok });
  return false;
});
