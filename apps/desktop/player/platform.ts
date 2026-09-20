/**
 * Platform services for the web player (Preview on Phone and the pop-out viewer).
 *
 * - Where the browser has navigator.vibrate (Android), it backs Vibrate and Haptic's vibration plans.
 * - A native host (the Sonobe Viewer iPhone app, a WKWebView) defines `window.sonobeNative` before the
 *   page loads and registers a script message handler named "sonobe". Haptic and Vibrate then go to
 *   the host, which plays them with UIFeedbackGenerator and Core Haptics.
 *
 * The bridge is one-way: the page posts `{ kind: "haptic", type, pattern? }` or
 * `{ kind: "vibrate", pattern }` (milliseconds on and off; 0 or [] stops), and the host plays what it
 * recognizes and ignores the rest. Nothing the host sends can change the document.
 */

import type { PlatformServices } from "@sonobe/engine";

/** What a native host announces in `window.sonobeNative`. */
export interface NativeHostInfo {
  /** Bridge version: 1 is haptics and vibration. */
  version: number;
  /** "ios" for Sonobe Viewer. */
  platform: string;
  /** Haptic Type keys (catalog enum keys) the device can play. */
  haptics: readonly string[];
  /** The host plays Vibrate patterns. */
  vibrate: boolean;
}

/** A message the player posts to the host's "sonobe" handler. */
export type NativeHostMessage = { kind: "haptic"; type: string; pattern?: unknown } | { kind: "vibrate"; pattern: number | number[] };

interface MessageHandler {
  postMessage(message: unknown): void;
}

/** The parts of `window` the player's platform reads. */
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

/** The native host's announcement and handler, or null in a plain browser or when either is malformed. */
export function readNativeHost(win: PlayerWindow): NativeHost | null {
  const raw = win.sonobeNative;
  const handler = win.webkit?.messageHandlers?.sonobe;
  if (!isRecord(raw) || typeof handler?.postMessage !== "function") return null;
  if (typeof raw.version !== "number" || !(raw.version >= 1) || !Array.isArray(raw.haptics)) return null;
  const info: NativeHostInfo = {
    version: raw.version,
    platform: typeof raw.platform === "string" ? raw.platform : "native",
    haptics: raw.haptics.filter((type): type is string => typeof type === "string"),
    vibrate: raw.vibrate === true,
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

/** Platform services for createRuntime in the player: vibration, and haptics from a native host. */
export function playerPlatform(win: PlayerWindow): PlatformServices {
  const platform: PlatformServices = {};
  const nav = win.navigator;
  if (typeof nav?.vibrate === "function") {
    platform.vibrate = (pattern) => {
      try {
        nav.vibrate!(pattern);
      } catch {
        // Blocked before the first touch.
      }
    };
  }
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
