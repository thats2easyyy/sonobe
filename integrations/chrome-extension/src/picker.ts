/**
 * Element picker (content script): highlights the element under the pointer, and on click (or Enter)
 * marks it for the capture and asks the service worker to copy it. ↑ selects the parent, ↓ goes back
 * down, Escape cancels. Runs once per activation.
 */

/// <reference types="chrome" />

const ATTR = "data-sonobe-capture-target";
const existing = (window as unknown as { __sonobePicker?: () => void }).__sonobePicker;
existing?.();

const host = document.createElement("div");
host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
const shadow = host.attachShadow({ mode: "closed" });
shadow.innerHTML = `<style>
  .box{position:fixed;border:2px solid #5B5CF6;background:rgba(91,92,246,.12);border-radius:3px;transition:all 60ms ease-out;pointer-events:none}
  .label{position:fixed;padding:3px 7px;border-radius:6px;background:#1C1C22;color:#fff;font:500 12px/1.3 system-ui,sans-serif;white-space:nowrap;pointer-events:none}
  .toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);padding:10px 14px;border-radius:12px;background:#1C1C22;color:#fff;font:500 13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);pointer-events:none}
</style><div class="box" hidden></div><div class="label" hidden></div><div class="toast">Click an element to copy it for Sonobe · ↑ parent · Esc to cancel</div>`;
const box = shadow.querySelector(".box") as HTMLElement;
const label = shadow.querySelector(".label") as HTMLElement;
const toast = shadow.querySelector(".toast") as HTMLElement;
document.documentElement.appendChild(host);

let current: Element | null = null;
/** Elements ↑ climbed out of, so ↓ can go back. */
let trail: Element[] = [];

const describe = (el: Element) => {
  const name = el.getAttribute("data-name") ?? el.getAttribute("aria-label") ?? (el.id ? `#${el.id}` : el.localName);
  const r = el.getBoundingClientRect();
  return `${name} · ${Math.round(r.width)} × ${Math.round(r.height)}`;
};

const highlight = (el: Element) => {
  current = el;
  const r = el.getBoundingClientRect();
  Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  box.hidden = false;
  label.textContent = describe(el);
  Object.assign(label.style, { left: `${Math.max(4, r.left)}px`, top: `${r.top > 28 ? r.top - 26 : r.bottom + 6}px` });
  label.hidden = false;
};

const onMove = (event: MouseEvent) => {
  const el = document.elementFromPoint(event.clientX, event.clientY);
  if (!el || el === host || el === current || trail.includes(el)) return;
  trail = [];
  highlight(el);
};

const stop = () => {
  document.removeEventListener("mousemove", onMove, true);
  document.removeEventListener("click", onClick, true);
  document.removeEventListener("keydown", onKey, true);
  box.hidden = true;
  label.hidden = true;
};

const done = (message: string, ms = 2600) => {
  toast.textContent = message;
  setTimeout(() => host.remove(), ms);
};

function onClick(event: Event) {
  if (!current) return;
  event.preventDefault();
  event.stopPropagation();
  const target = current;
  stop();
  toast.textContent = "Copying…";
  document.querySelectorAll(`[${ATTR}]`).forEach((el) => el.removeAttribute(ATTR));
  target.setAttribute(ATTR, "");
  chrome.runtime.sendMessage({ type: "sonobe-picked" }, (reply: { ok: boolean; summary?: string; message?: string } | undefined) => {
    target.removeAttribute(ATTR);
    if (reply?.ok) done(`Copied (${reply.summary}). Paste it into Sonobe with ⌘V.`);
    else done(`Couldn't copy it: ${reply?.message ?? chrome.runtime.lastError?.message ?? "no answer"}`, 4000);
  });
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    stop();
    host.remove();
  } else if (event.key === "ArrowUp" && current?.parentElement && current.parentElement !== document.documentElement) {
    event.preventDefault();
    trail.push(current);
    highlight(current.parentElement);
  } else if (event.key === "ArrowDown" && trail.length) {
    event.preventDefault();
    highlight(trail.pop()!);
  } else if (event.key === "Enter" && current) onClick(event);
}

document.addEventListener("mousemove", onMove, true);
document.addEventListener("click", onClick, true);
document.addEventListener("keydown", onKey, true);
(window as unknown as { __sonobePicker?: () => void }).__sonobePicker = () => {
  stop();
  host.remove();
};
