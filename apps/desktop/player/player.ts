/**
 * Phone web player, served by the LAN preview server (electron/lan-preview.ts). Runs the open
 * prototype full-screen with the real engine and DOM renderer, and follows edits made in Sonobe over
 * a WebSocket: new revisions hot-swap into the running prototype, keeping patch state.
 */

import type { SonobeDocument } from "@sonobe/core";
import { createRuntime, type SonobeRuntime } from "@sonobe/engine";
import { createPatchRegistry } from "@sonobe/patches";
import { createDomRenderer, createFontAssetRegistry, DomTextMeasurer, type DomRenderer, type LottiePlayerLike } from "@sonobe/renderer";

let lottiePlayer: Promise<LottiePlayerLike> | null = null;

/** lottie-web ships as lottie.js next to this bundle and loads the first time a Lottie layer draws. */
function loadLottie(): Promise<LottiePlayerLike> {
  lottiePlayer ??= new Promise<LottiePlayerLike>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "lottie.js";
    script.onload = () => {
      const player = (globalThis as { sonobeLottie?: LottiePlayerLike }).sonobeLottie;
      if (player && typeof player.loadAnimation === "function") resolve(player);
      else reject(new Error("lottie.js loaded without a player"));
    };
    script.onerror = () => {
      lottiePlayer = null;
      script.remove();
      reject(new Error("lottie.js didn't load"));
    };
    document.head.appendChild(script);
  });
  return lottiePlayer;
}

type Message =
  | { type: "hello"; version: string }
  | { type: "document"; docId: string; name: string; revision: number; doc: SonobeDocument }
  | { type: "offline"; message: string };

const stageHost = document.getElementById("stage") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;
const registry = createPatchRegistry();
const measurer = new DomTextMeasurer();

let doc: SonobeDocument | null = null;
let docId: string | null = null;
let runtime: SonobeRuntime | null = null;
let renderer: DomRenderer | null = null;
let size: [number, number] = [0, 0];
let generation = 0;
let statusTimer: ReturnType<typeof setTimeout> | undefined;

function setStatus(text: string, state: "live" | "waiting" | "error", autoHide = false): void {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
  statusEl.classList.add("visible");
  clearTimeout(statusTimer);
  if (autoHide) statusTimer = setTimeout(() => statusEl.classList.remove("visible"), 2400);
}

const resolveAssetUrl = (assetId: string): string | undefined => {
  const record = doc?.assets[assetId];
  return record ? `assets/${encodeURIComponent(record.file)}` : undefined;
};

function layout(): void {
  if (!renderer || !size[0] || !size[1]) return;
  const scale = Math.min(window.innerWidth / size[0], window.innerHeight / size[1]);
  renderer.setScale(scale);
  stageHost.style.width = `${size[0] * scale}px`;
  stageHost.style.height = `${size[1] * scale}px`;
}

function run(): void {
  const id = ++generation;
  let last = 0;
  const frame = (now: number) => {
    if (id !== generation || !runtime || !renderer) return;
    const dt = last && !document.hidden ? Math.min(0.064, (now - last) / 1000) : 1 / 60;
    last = now;
    const scene = runtime.step(dt);
    if (scene.size[0] !== size[0] || scene.size[1] !== size[1]) {
      size = [scene.size[0], scene.size[1]];
      layout();
    }
    renderer.render(scene);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

const fontAssets = createFontAssetRegistry((assetId) => resolveAssetUrl(assetId));

function show(message: Extract<Message, { type: "document" }>): void {
  const otherDocument = docId !== null && message.docId !== docId;
  doc = message.doc;
  fontAssets.sync(message.doc.assets);
  document.title = `${message.name} · Sonobe`;
  if (!runtime || !renderer || otherDocument) {
    runtime?.dispose();
    renderer?.dispose();
    stageHost.replaceChildren();
    const next = createRuntime(message.doc, { registry, textMeasurer: measurer, resolveAssetUrl });
    runtime = next;
    renderer = createDomRenderer(stageHost, { resolveAssetUrl, textMeasurer: measurer, loadLottie, onEvents: (events) => next.dispatch(events) });
    size = [0, 0];
    run();
  } else {
    runtime.updateDocument(message.doc);
  }
  docId = message.docId;
  setStatus(`Live · ${message.name}`, "live", true);
}

let attempt = 0;

function connect(): void {
  const url = new URL("sync", window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);
  socket.addEventListener("open", () => {
    attempt = 0;
  });
  socket.addEventListener("message", (event) => {
    let message: Message;
    try {
      message = JSON.parse(String(event.data)) as Message;
    } catch {
      return;
    }
    if (message.type === "document") show(message);
    else if (message.type === "offline") setStatus(message.message, "waiting");
  });
  socket.addEventListener("close", () => {
    setStatus(doc ? "Reconnecting to Sonobe…" : "Can't reach Sonobe. Is it still running on your computer?", "error");
    const delay = Math.min(5000, 500 * 2 ** attempt++);
    setTimeout(connect, delay);
  });
}

window.addEventListener("resize", layout);
setStatus("Connecting to Sonobe…", "waiting");
connect();
