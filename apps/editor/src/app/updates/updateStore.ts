/**
 * Where this copy of Sonobe stands with updates, as the desktop app reports it: one status that the
 * notices (notices.ts), About and Settings read, and the actions they offer. Without a host that has
 * updates (the browser, an older preload) the status stays null and every action does nothing.
 */

import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { getDesktopHostApi } from "../../host/detect.ts";
import { getUpdatesHost, type UpdatesHost, type UpdateStatus } from "./updatesHost.ts";

export interface UpdatesState {
  /** Null until the host answers, and for good without one. */
  status: UpdateStatus | null;
  /** Check for Updates…: the notices answer, whatever the check finds. */
  check: () => Promise<void>;
  /** Restart to Update. Resolves false when Sonobe is still here: the person cancelled, or it failed. */
  restart: () => Promise<boolean>;
  setAutoCheck: (enabled: boolean) => Promise<void>;
  /** Move Sonobe to the Applications folder and open it there. Resolves false when it stayed where it was. */
  moveToApplications: () => Promise<boolean>;
}

/** The status comes only from followUpdates: the host sends every change, an action's own answer included. */
export function createUpdateStore(host: () => UpdatesHost | null = getUpdatesHost): StoreApi<UpdatesState> {
  return createStore<UpdatesState>()(() => ({
    status: null,
    check: async () => void (await host()?.check()),
    restart: async () => (await host()?.restart()) ?? false,
    setAutoCheck: async (enabled) => void (await host()?.setAutoCheck(enabled)),
    moveToApplications: async () => (await host()?.moveToApplications()) ?? false,
  }));
}

export const updateStore = createUpdateStore();

export function useUpdates<T>(selector: (state: UpdatesState) => T): T {
  return useStore(updateStore, selector);
}

/**
 * Follows the host's update status. It subscribes before it asks, so the app knows a window is
 * listening (its notices then answer Check for Updates…, not a native dialog), and an answer that
 * arrives after a newer change is dropped. The host answers the first question about a second after
 * the window is shown, so nothing about updates runs during launch. Returns the unsubscribe.
 */
export function followUpdates(store: StoreApi<UpdatesState> = updateStore, host: UpdatesHost | null = getUpdatesHost()): () => void {
  if (!host) return () => undefined;
  let live = true;
  let pushed = false;
  const off = host.onStatus((status) => {
    pushed = true;
    if (live) store.setState({ status });
  });
  void host
    .status()
    .then((status) => {
      if (live && !pushed && status) store.setState({ status });
    })
    .catch(() => undefined);
  return () => {
    live = false;
    off();
  };
}

/** Opens a release page or its notes in the system browser. */
export function openReleasePage(url: string): void {
  if (!url) return;
  const api = getDesktopHostApi();
  if (api?.openExternal) void api.openExternal(url);
  else if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
}
