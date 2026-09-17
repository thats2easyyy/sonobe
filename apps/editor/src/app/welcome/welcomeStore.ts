/**
 * The welcome screen's open state: shown on the first launch (or every launch when the setting is
 * on), from File → New, after File → Close, and from Help. Remembers that this viewer has seen it.
 */

import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { readString, writeString } from "../../ui/lib/storage.ts";

/** Why the screen is open. "new" and "close" hide "Keep working" (there's nothing to go back to after Close). */
export type WelcomeReason = "launch" | "new" | "close" | "menu";

export const WELCOME_SEEN_KEY = "sonobe.welcome.v1";

export interface WelcomeState {
  open: boolean;
  reason: WelcomeReason;
  show: (reason?: WelcomeReason) => void;
  hide: () => void;
}

export interface WelcomeStoreOptions {
  /** null disables persistence. */
  storageKey?: string | null;
}

export function hasSeenWelcome(key: string | null = WELCOME_SEEN_KEY): boolean {
  return key ? readString(key) !== null : false;
}

/** Launch behavior: always the first time, then only when the setting asks for it. */
export function shouldShowWelcomeOnLaunch(seen: boolean, showOnLaunch: boolean): boolean {
  return !seen || showOnLaunch;
}

export function createWelcomeStore(options: WelcomeStoreOptions = {}): StoreApi<WelcomeState> {
  const key = options.storageKey === undefined ? WELCOME_SEEN_KEY : options.storageKey;
  return createStore<WelcomeState>()((set) => ({
    open: false,
    reason: "launch",
    show: (reason = "menu") => {
      if (key) writeString(key, "seen");
      set({ open: true, reason });
    },
    hide: () => set({ open: false }),
  }));
}

export const welcomeStore = createWelcomeStore();

export function useWelcome<T>(selector: (state: WelcomeState) => T): T {
  return useStore(welcomeStore, selector);
}
