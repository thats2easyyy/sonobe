/**
 * Platform services for the web player (Preview on Phone and the pop-out viewer).
 *
 * - The editor viewer's browser services (`createBrowserPlatform` in @sonobe/renderer): sound,
 *   speech, Network Request, Open URL, WebSockets, location, device motion, camera and microphone,
 *   and navigator.vibrate where the browser has it (Android). The same mute switch applies, so an
 *   automated browser or `?mute=1` keeps the player silent.
 * - A native host (the Sonobe Viewer iPhone app, a WKWebView) defines `window.sonobeNative` before the
 *   page loads and registers a script message handler named "sonobe". Haptic and Vibrate then go to
 *   the host, which plays them with UIFeedbackGenerator and Core Haptics.
 *
 * The bridge is one-way: the page posts `{ kind: "haptic", type, pattern? }` or
 * `{ kind: "vibrate", pattern }` (milliseconds on and off; 0 or [] stops), and from version 2 the
 * player menu's `{ kind: "openAnother" }` and `{ kind: "menuTipSeen" }`. The host plays or does what
 * it recognizes and ignores the rest. Nothing the host sends can change the document.
 */

import { createBrowserPlatform, type BrowserPlatform, type BrowserPlatformOptions, type PlatformWindow } from "@sonobe/renderer";

/** What a native host announces in `window.sonobeNative`. */
export interface NativeHostInfo {
  /** Bridge version: 1 is haptics and vibration; 2 adds the menu's actions and tip. */
  version: number;
  /** "ios" for Sonobe Viewer. */
  platform: string;
  /** Haptic Type keys (catalog enum keys) the device can play. */
  haptics: readonly string[];
  /** The host plays Vibrate patterns. */
  vibrate: boolean;
  /** Menu actions the host takes when the page posts `{ kind: action }`: "openAnother" goes back to its connect screen. */
  actions: readonly string[];
  /** The person already saw the three-finger tip in this app. */
  menuTipSeen: boolean;
}

/** A message the player posts to the host's "sonobe" handler. */
export type NativeHostMessage = { kind: "haptic"; type: string; pattern?: unknown } | { kind: "vibrate"; pattern: number | number[] } | { kind: "openAnother" } | { kind: "menuTipSeen" };

interface MessageHandler {
  postMessage(message: unknown): void;
}

/** The parts of `window` the native bridge reads. */
export interface PlayerWindow {
  navigator?: { vibrate?(pattern: number | number[]): boolean };
  sonobeNative?: unknown;
  webkit?: { messageHandlers?: Record<string, MessageHandler | undefined> };
}

export interface NativeHost {
  info: NativeHostInfo;
  post(message: NativeHostMessage): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/** The native host's announcement and handler, or null in a plain browser or when either is malformed. */
export function readNativeHost(win: PlayerWindow): NativeHost | null {
  const raw = win.sonobeNative;
  const handler = win.webkit?.messageHandlers?.sonobe;
  if (!isRecord(raw) || typeof handler?.postMessage !== "function") return null;
  if (typeof raw.version !== "number" || !(raw.version >= 1) || !Array.isArray(raw.haptics)) return null;
  const info: NativeHostInfo = {
    version: raw.version,
    platform: typeof raw.platform === "string" ? raw.platform : "native",
    haptics: strings(raw.haptics),
    vibrate: raw.vibrate === true,
    actions: raw.version >= 2 ? strings(raw.actions) : [],
    menuTipSeen: raw.menuTipSeen === true,
  };
  return {
    info,
    post(message) {
      try {
        handler.postMessage(message);
      } catch {
        // The host is closing the view.
      }
    },
  };
}

/**
 * Platform services for createRuntime in the player: the browser's services, with Haptic and Vibrate
 * going to a native host when one announces itself.
 */
export function playerPlatform(win: PlayerWindow, options: Omit<BrowserPlatformOptions, "window"> = {}): BrowserPlatform {
  const platform = createBrowserPlatform({ ...options, window: win as PlatformWindow });
  const native = readNativeHost(win);
  if (native) {
    const supported = new Set(native.info.haptics);
    platform.haptic = {
      supports: (type) => supported.has(type),
      play: (type, pattern) => native.post(pattern === undefined ? { kind: "haptic", type } : { kind: "haptic", type, pattern }),
    };
    if (native.info.vibrate) platform.vibrate = (pattern) => native.post({ kind: "vibrate", pattern });
  }
  return platform;
}
