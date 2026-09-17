/** Pick the host adapter for the current environment. */

import { createBrowserHost, type BrowserHostOptions } from "./browserHost.ts";
import { createDesktopHost } from "./desktopHost.ts";
import type { DesktopHostApi, HostAdapter } from "./types.ts";

/** `window.sonobeHost` when running inside the desktop app. */
export function getDesktopHostApi(): DesktopHostApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { sonobeHost?: DesktopHostApi }).sonobeHost;
}

/** DesktopHost when `window.sonobeHost` exists, otherwise BrowserHost. */
export function createHostAdapter(browserOptions: BrowserHostOptions = {}): HostAdapter {
  const api = getDesktopHostApi();
  return api ? createDesktopHost(api) : createBrowserHost(browserOptions);
}
