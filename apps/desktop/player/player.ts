/**
 * Phone web player, served by the LAN preview server (electron/lan-preview.ts). Runs the open
 * prototype full-screen with the real engine and DOM renderer, and follows edits made in Sonobe over
 * a WebSocket: new revisions hot-swap into the running prototype, keeping patch state, and restarting
 * the prototype in Sonobe restarts it here too. While nothing in the prototype moves it asks for no
 * frames (`wake`). platform.ts gives it the editor viewer's services
 * (sound, speech, network, links, media) plus haptics through a native host like Sonobe Viewer, and
 * device.ts tells it about the phone (appearance, safe area, rotation). A three-finger tap opens the
 * player's menu (gesture.ts, menu.ts).
 */

import { deviceScreenSize, type LayerRef, type SonobeDocument } from "@sonobe/core";
import { createRuntime, type InputEvent, type SceneFrame, type SonobeRuntime } from "@sonobe/engine";
import { createPatchRegistry } from "@sonobe/patches";
import { clientToPrototype, createDomRenderer, createFontAssetRegistry, createLiveVideoOverlays, DomTextMeasurer, eventTime, type DomRenderer, type LiveVideoOverlays, type LottiePlayerLike } from "@sonobe/renderer";
import { isMobileDevice, playerDevice, type Insets, type PlayerStage } from "./device.ts";
import { createMenuGesture, type GestureDecision } from "./gesture.ts";
import { createPlayerMenu, showTip, type PlayerMenuItem } from "./menu.ts";
import { playerPlatform, readNativeHost, syncUrl } from "./platform.ts";
import { withPausableScripts } from "./scripts.ts";

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
  | { type: "document"; docId: string; name: string; revision: number; doc: SonobeDocument; scriptsPaused?: boolean }
  | { type: "restart" }
  | { type: "offline"; message: string };

const stageHost = document.getElementById("stage") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;
/** The project's scripts wait for the person's trust in Sonobe (scripts.ts). */
let scriptsPaused = false;
const registry = withPausableScripts(createPatchRegistry(), () => scriptsPaused);
const measurer = new DomTextMeasurer();
const native = readNativeHost(window);

let doc: SonobeDocument | null = null;
let docId: string | null = null;
let docName = "";
let runtime: SonobeRuntime | null = null;
let renderer: DomRenderer | null = null;
let liveVideos: LiveVideoOverlays | null = null;
let lastScene: SceneFrame | null = null;
let size: [number, number] = [0, 0];
/** A frame is asked for. While the prototype rests none is. */
let scheduled = false;
/** When the last frame ran (0 before a prototype's first). */
let lastFrameAt = 0;
let connected = false;
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

/** The element drawing a layer (camera pixel reads): its own copy, or the first node that draws it. */
function layerElement(ref: LayerRef): HTMLElement | undefined {
  if (!renderer) return undefined;
  if (ref.instance !== undefined) return renderer.elementForKey(`${ref.layerId}#${ref.instance}`);
  const direct = renderer.elementForKey(ref.layerId);
  if (direct || !lastScene) return direct;
  const queue = [...lastScene.roots];
  while (queue.length) {
    const node = queue.shift()!;
    if (node.layerId === ref.layerId) return renderer.elementForKey(node.key);
    queue.push(...node.children);
  }
  return undefined;
}

const platform = playerPlatform(window, { resolveAssetUrl, layerElement });

// --- The device: what Device Info reads (device.ts) ------------------------------------------------

const mobile = isMobileDevice(window, native !== null);
/** Padded by env(safe-area-inset-*) in player.css, so its computed padding is the system's insets. */
const safeAreaProbe = document.getElementById("safe-area");

function systemInsets(): Insets {
  if (!safeAreaProbe) return [0, 0, 0, 0];
  const style = getComputedStyle(safeAreaProbe);
  const px = (value: string) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };
  return [px(style.paddingTop), px(style.paddingRight), px(style.paddingBottom), px(style.paddingLeft)];
}

/** A prototype of `points` drawn to fit this window, centered (layout). */
function stageFor(points: [number, number]): PlayerStage | null {
  if (!points[0] || !points[1]) return null;
  const viewport: [number, number] = [window.innerWidth, window.innerHeight];
  return { viewport, size: points, scale: Math.min(viewport[0] / points[0], viewport[1] / points[1]) };
}

const deviceFor = (points: [number, number]) => playerDevice(window, { mobile, insets: systemInsets(), stage: stageFor(points) });
let reportedDevice = "";

/** Tell the running prototype what changed about the device: the phone turning, the appearance, the insets. */
function syncDevice(): void {
  if (!runtime || !size[0] || !size[1]) return;
  const device = deviceFor(size);
  const key = JSON.stringify(device);
  if (key === reportedDevice) return;
  reportedDevice = key;
  runtime.setDevice(device);
}

function layout(): void {
  const stage = stageFor(size);
  if (!renderer || !stage) return;
  renderer.setScale(stage.scale);
  stageHost.style.width = `${size[0] * stage.scale}px`;
  stageHost.style.height = `${size[1] * stage.scale}px`;
  syncDevice();
}

function frame(now: number): void {
  scheduled = false;
  if (!runtime || !renderer) return;
  // The whole time since the last frame: the runtime caps a slow frame at 64 ms and knows a rest from one.
  const dt = lastFrameAt && !document.hidden ? (now - lastFrameAt) / 1000 : 1 / 60;
  lastFrameAt = now;
  const scene = runtime.step(dt);
  lastScene = scene;
  if (scene.size[0] !== size[0] || scene.size[1] !== size[1]) {
    size = [scene.size[0], scene.size[1]];
    layout();
  }
  renderer.render(scene);
  try {
    liveVideos?.sync(scene);
  } catch {
    // A camera feed that can't show doesn't stop the prototype.
  }
  if (!runtime.resting) wake();
}

/**
 * Ask for a frame. The loop stops asking once the runtime is at rest (ARCHITECTURE.md §5.2), so a
 * prototype where nothing moves leaves the phone idle. Everything that can change a frame here goes
 * through the runtime, which calls this as its `onWake`: touches, keys and text (the renderer's
 * events), fingers taken for the menu (cancelTouches), a new revision from Sonobe (updateDocument),
 * a restart from Sonobe or the menu, the phone turning, its appearance and its safe area (syncDevice),
 * and a font that finished loading (refreshScene, below). Whatever a patch waits on, it asks for
 * frames while it waits. A resize alone needs no step: setScale draws the last frame again.
 */
function wake(): void {
  if (scheduled || !runtime || !renderer) return;
  scheduled = true;
  requestAnimationFrame(frame);
}

// The engine lays text out with this measurer, so a font that finishes loading changes the layout.
measurer.onInvalidate(() => {
  if (runtime && runtime.frame >= 0) runtime.refreshScene();
});

const fontAssets = createFontAssetRegistry((assetId) => resolveAssetUrl(assetId));

/** Start the prototype over from its first frame: patch state, sounds, speech, sockets and cameras. */
function restartPrototype(note?: string): void {
  if (!runtime) return;
  runtime.restart();
  platform.reset();
  if (note) setStatus(note, "live", true);
}

function show(message: Extract<Message, { type: "document" }>): void {
  const otherDocument = docId !== null && message.docId !== docId;
  doc = message.doc;
  docName = message.name;
  scriptsPaused = message.scriptsPaused === true;
  fontAssets.sync(message.doc.assets);
  document.title = `${message.name} · Sonobe`;
  if (!runtime || !renderer || otherDocument) {
    runtime?.dispose();
    liveVideos?.dispose();
    renderer?.dispose();
    platform.reset();
    stageHost.replaceChildren();
    const device = deviceFor(deviceScreenSize(message.doc.project.device));
    reportedDevice = JSON.stringify(device);
    const next = createRuntime(message.doc, { registry, textMeasurer: measurer, resolveAssetUrl, platform, device, onWake: wake });
    runtime = next;
    renderer = createDomRenderer(stageHost, { resolveAssetUrl, textMeasurer: measurer, loadLottie, onEvents: (events) => next.dispatch(events) });
    liveVideos = createLiveVideoOverlays(renderer, platform);
    lastScene = null;
    size = [0, 0];
    lastFrameAt = 0;
    wake();
  } else {
    runtime.updateDocument(message.doc);
  }
  docId = message.docId;
  setStatus(`Live · ${message.name}`, "live", true);
  offerTip();
}

// --- The menu: a three-finger tap -----------------------------------------------------------------

const TIP_KEY = "sonobe.player.menuTip";
let tipOffered = false;
let dismissTip: (() => void) | null = null;

function tipSeen(): boolean {
  if (native?.info.menuTipSeen) return true;
  try {
    return localStorage.getItem(TIP_KEY) === "seen";
  } catch {
    return false;
  }
}

function markTipSeen(): void {
  if (tipSeen()) return;
  try {
    localStorage.setItem(TIP_KEY, "seen");
  } catch {
    // Private mode: the tip may show again next time.
  }
  // Sonobe Viewer keeps no web storage between launches, so it remembers the tip itself.
  if (native && native.info.version >= 2) native.post({ kind: "menuTipSeen" });
}

/** Once, on touch screens: how to open the menu. */
function offerTip(): void {
  if (tipOffered) return;
  tipOffered = true;
  if (!(navigator.maxTouchPoints > 0) || tipSeen()) return;
  setTimeout(() => {
    if (menu.isOpen || tipSeen()) return;
    dismissTip = showTip(document, "Tap with three fingers for the menu");
    markTipSeen();
  }, 1200);
}

function menuItems(): PlayerMenuItem[] {
  const items: PlayerMenuItem[] = [];
  if (runtime) items.push({ id: "restart", label: "Restart Prototype", run: () => restartPrototype("Restarted") });
  items.push({ id: "reload", label: "Reload", run: () => window.location.reload() });
  if (native?.info.actions.includes("openAnother")) items.push({ id: "openAnother", label: "Open Another Prototype", run: () => native.post({ kind: "openAnother" }) });
  return items;
}

const menu = createPlayerMenu(document, {
  title: () => docName || "Sonobe",
  subtitle: () => (connected ? (doc ? "Live from Sonobe" : "Waiting for a prototype") : "Reconnecting to Sonobe…"),
  items: menuItems,
  onOpen: () => {
    markTipSeen();
    dismissTip?.();
  },
});

/** Tell the prototype that fingers it has were taken for the menu gesture. */
function cancelTouches(fingers: NonNullable<GestureDecision["cancel"]>, timeStamp: number): void {
  if (!runtime || !renderer) return;
  const rect = renderer.stage.getBoundingClientRect();
  const events: InputEvent[] = fingers.map((f) => {
    const [x, y] = clientToPrototype(f.clientX, f.clientY, rect, size[0] ? size : null, 1);
    return { kind: "pointer", phase: "cancel", pointerId: f.pointerId, pointerType: "touch", timeStamp, x, y };
  });
  runtime.dispatch(events);
}

const gesture = createMenuGesture();
const onPointer = (e: PointerEvent) => {
  const decision = gesture.handle(e);
  if (decision.cancel?.length) cancelTouches(decision.cancel, eventTime(e));
  if (decision.swallow) e.stopPropagation();
  if (decision.tap) menu.open();
};
for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "pointerleave"]) window.addEventListener(type, onPointer as EventListener, { capture: true });

// A three-finger touch makes no clicks or focus changes either (touch events follow pointer events).
let holdingTouches = false;
const onTouch = (e: TouchEvent) => {
  // A touchstart with one finger starts a new touch, so a lift the browser never reported can't keep this on.
  if (e.type === "touchstart") holdingTouches = e.touches.length >= 3 || gesture.claimed || (holdingTouches && e.touches.length > 1);
  if (!holdingTouches) return;
  if (e.cancelable) e.preventDefault();
  e.stopPropagation();
  if ((e.type === "touchend" || e.type === "touchcancel") && e.touches.length === 0) holdingTouches = false;
};
for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) window.addEventListener(type, onTouch as EventListener, { capture: true, passive: false });

// --- Sync with Sonobe -----------------------------------------------------------------------------

let attempt = 0;

function connect(): void {
  const socket = new WebSocket(syncUrl(window.location.href));
  socket.addEventListener("open", () => {
    attempt = 0;
    connected = true;
  });
  socket.addEventListener("message", (event) => {
    let message: Message;
    try {
      message = JSON.parse(String(event.data)) as Message;
    } catch {
      return;
    }
    if (message.type === "document") show(message);
    else if (message.type === "restart") restartPrototype("Restarted from Sonobe");
    else if (message.type === "offline") setStatus(message.message, "waiting");
  });
  socket.addEventListener("close", () => {
    connected = false;
    setStatus(doc ? "Reconnecting to Sonobe…" : "Can't reach Sonobe. Is it still running on your computer?", "error");
    const delay = Math.min(5000, 500 * 2 ** attempt++);
    setTimeout(connect, delay);
  });
}

window.addEventListener("resize", layout);
// A turn resizes the window too, but its new insets can settle a little after that: look again.
const turned = () => {
  syncDevice();
  setTimeout(syncDevice, 300);
};
screen.orientation?.addEventListener("change", turned);
window.addEventListener("orientationchange", turned);
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", syncDevice);
setStatus("Connecting to Sonobe…", "waiting");
connect();
