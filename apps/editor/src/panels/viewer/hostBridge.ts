/**
 * Optional host and session capabilities the Viewer and Canvas panels use when they exist, detected at
 * runtime so the panels keep working in the browser, in tests, and in older desktop builds:
 *
 * - the desktop phone preview server (`sonobeHost.getPreviewStatus/startPreview/stopPreview/onPreviewStatus`)
 * - a host viewer window (`sonobeHost.popOutViewer`)
 * - screenshot target bounds (`canvas.bounds`, `viewer.layerBounds`) through the session's bounds
 *   registry, or straight through the desktop RPC bridge when there is no registry
 */

import { getDesktopHostApi } from "../../host/detect.ts";
import type { EditorSession } from "../../state/session.ts";

/** The phone preview server (LAN web player). Mirrors `PreviewStatus` in apps/desktop/electron/host-api.d.ts. */
export interface PreviewStatus {
  running: boolean;
  /** Player URL for a phone on the same Wi-Fi, with its access token; null when stopped. */
  url: string | null;
  /** Every usable player URL, best first. */
  urls: string[];
  /** False when no local network address was found: only this computer can open the URL. */
  lanReachable: boolean;
  /** Players connected right now. */
  clients: number;
  /** Why the server couldn't start, when it couldn't. */
  error: string | null;
}

export interface PreviewHostApi {
  getPreviewStatus(): Promise<PreviewStatus>;
  startPreview(): Promise<PreviewStatus>;
  stopPreview(): Promise<PreviewStatus>;
  onPreviewStatus?(cb: (status: PreviewStatus) => void): () => void;
}

const isFn = (v: unknown): v is (...args: never[]) => unknown => typeof v === "function";

/** A normalized preview status, or null when `value` doesn't look like one. */
export function toPreviewStatus(value: unknown): PreviewStatus | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.running !== "boolean") return null;
  const url = typeof v.url === "string" && v.url ? v.url : null;
  const urls = Array.isArray(v.urls) ? v.urls.filter((u): u is string => typeof u === "string" && u.length > 0) : [];
  return {
    running: v.running,
    url: url ?? (v.running ? (urls[0] ?? null) : null),
    urls: urls.length ? urls : url ? [url] : [],
    lanReachable: v.lanReachable !== false,
    clients: typeof v.clients === "number" && Number.isFinite(v.clients) ? Math.max(0, Math.floor(v.clients)) : 0,
    error: typeof v.error === "string" && v.error ? v.error : null,
  };
}

/** The desktop phone preview API, when the host has one. */
export function getPreviewHostApi(): PreviewHostApi | null {
  const api = getDesktopHostApi() as unknown as Partial<PreviewHostApi> | undefined;
  if (!api || !isFn(api.getPreviewStatus) || !isFn(api.startPreview) || !isFn(api.stopPreview)) return null;
  return {
    getPreviewStatus: () => api.getPreviewStatus!(),
    startPreview: () => api.startPreview!(),
    stopPreview: () => api.stopPreview!(),
    ...(isFn(api.onPreviewStatus) ? { onPreviewStatus: (cb: (status: PreviewStatus) => void) => api.onPreviewStatus!(cb) } : {}),
  };
}

/** The pop-out viewer window. Mirrors `ViewerWindowStatus` in apps/desktop/electron/host-api.d.ts. */
export interface ViewerWindowStatus {
  open: boolean;
  alwaysOnTop: boolean;
  /** Why the window couldn't open, when it couldn't. */
  error: string | null;
}

export interface ViewerWindowApi {
  /** Show the prototype in its own window, or focus it when it's open. */
  popOut(options?: { alwaysOnTop?: boolean }): Promise<ViewerWindowStatus>;
  close: (() => Promise<ViewerWindowStatus>) | null;
  getStatus: (() => Promise<ViewerWindowStatus>) | null;
  onStatus: ((cb: (status: ViewerWindowStatus) => void) => () => void) | null;
}

/** A normalized window status. Hosts that resolve nothing count as opened; false or { ok: false } as declined. */
export function toViewerWindowStatus(value: unknown): ViewerWindowStatus {
  if (value === false) return { open: false, alwaysOnTop: false, error: null };
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    const open = typeof v.open === "boolean" ? v.open : v.ok !== false;
    return { open, alwaysOnTop: v.alwaysOnTop === true, error: typeof v.error === "string" && v.error ? v.error : null };
  }
  return { open: true, alwaysOnTop: false, error: null };
}

/** `sonobeHost.popOutViewer` (and its status and close methods) when the desktop can show the viewer in its own window. */
export function getViewerWindowApi(): ViewerWindowApi | null {
  const api = getDesktopHostApi() as unknown as
    | { popOutViewer?: (options?: { alwaysOnTop?: boolean }) => unknown; closeViewerWindow?: () => unknown; getViewerWindowStatus?: () => unknown; onViewerWindowStatus?: (cb: (status: unknown) => void) => () => void }
    | undefined;
  if (!api || !isFn(api.popOutViewer)) return null;
  return {
    popOut: async (options) => toViewerWindowStatus(await api.popOutViewer!(...(options ? [options] : []))),
    close: isFn(api.closeViewerWindow) ? async () => toViewerWindowStatus(await api.closeViewerWindow!()) : null,
    getStatus: isFn(api.getViewerWindowStatus) ? async () => toViewerWindowStatus(await api.getViewerWindowStatus!()) : null,
    onStatus: isFn(api.onViewerWindowStatus) ? (cb) => api.onViewerWindowStatus!((status) => cb(toViewerWindowStatus(status))) : null,
  };
}

// ---------------------------------------------------------------------------
// Screenshot target bounds
// ---------------------------------------------------------------------------

export type BoundsMethod = "canvas.bounds" | "graph.bounds" | "viewer.layerBounds";

/** A rect in viewport CSS pixels. `scale` is CSS pixels per prototype point. */
export interface BoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
  scale?: number;
  /** canvas.bounds: where the artboard is, in viewport CSS pixels. */
  artboard?: { x: number; y: number; width: number; height: number };
}

/** Answers a bounds request; null when the target isn't on screen. */
export type BoundsProvider = (params: unknown) => BoundsRect | null;

interface RegistryLike {
  register?: (method: string, provider: BoundsProvider) => unknown;
  set?: (method: string, provider: BoundsProvider | null) => unknown;
  unregister?: (method: string, provider?: BoundsProvider) => unknown;
  delete?: (method: string) => unknown;
}

const UNAVAILABLE: Record<BoundsMethod, string> = {
  "canvas.bounds": "The Canvas isn't showing, so there's nothing to capture.",
  "graph.bounds": "The Patch Editor isn't showing, so there's nothing to capture.",
  "viewer.layerBounds": "That layer isn't showing in the Viewer right now.",
};

/** How a provider was registered (for tests and diagnostics). */
export type BoundsRegistration = "registry" | "rpc" | "none";

/**
 * Register a screenshot bounds provider. Prefers the session's bounds registry (`session.bounds`,
 * `session.boundsRegistry`, or `session.registerBoundsProvider`); without one, registers the method on
 * the desktop RPC bridge unless something else already answers it. Returns an unregister function.
 */
export function registerBoundsProvider(session: EditorSession, method: BoundsMethod, provider: BoundsProvider): { dispose: () => void; via: BoundsRegistration } {
  const s = session as unknown as Record<string, unknown>;
  if (isFn(s.registerBoundsProvider)) {
    const off = (s.registerBoundsProvider as (m: string, p: BoundsProvider) => unknown)(method, provider);
    return { dispose: isFn(off) ? (off as () => void) : () => undefined, via: "registry" };
  }
  for (const key of ["bounds", "boundsRegistry", "boundsProviders"]) {
    const registry = s[key] as RegistryLike | undefined;
    if (!registry || typeof registry !== "object") continue;
    if (isFn(registry.register)) {
      const off = registry.register(method, provider);
      return {
        dispose: () => {
          if (isFn(off)) (off as () => void)();
          else if (isFn(registry.unregister)) registry.unregister(method, provider);
          else if (isFn(registry.delete)) registry.delete(method);
        },
        via: "registry",
      };
    }
    if (isFn(registry.set)) {
      const off = registry.set(method, provider);
      return {
        dispose: () => {
          if (isFn(off)) (off as () => void)();
          else registry.set!(method, null);
        },
        via: "registry",
      };
    }
  }
  const rpc = session.host?.rpc;
  if (rpc && !(rpc.methods?.() ?? []).includes(method)) {
    const off = rpc.handle(method, (params) => {
      const rect = provider(params);
      return rect ?? rpc.fail("target_unavailable", UNAVAILABLE[method]);
    });
    return { dispose: off, via: "rpc" };
  }
  return { dispose: () => undefined, via: "none" };
}
