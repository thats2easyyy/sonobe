/** App-wide open state for the Connect Claude dialog, so the menu, toolbar, HUD, and Learn can all open it. */

import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

export type ConnectTab = "code" | "desktop";

export interface ConnectClaudeState {
  open: boolean;
  tab: ConnectTab;
  /** Open, optionally on a tab. */
  show: (tab?: ConnectTab) => void;
  hide: () => void;
  setOpen: (open: boolean) => void;
}

export function createConnectClaudeStore(): StoreApi<ConnectClaudeState> {
  return createStore<ConnectClaudeState>()((set) => ({
    open: false,
    tab: "code",
    show: (tab) => set((s) => ({ open: true, tab: tab ?? s.tab })),
    hide: () => set({ open: false }),
    setOpen: (open) => set({ open }),
  }));
}

export const connectClaudeStore = createConnectClaudeStore();

export function useConnectClaude<T>(selector: (state: ConnectClaudeState) => T): T {
  return useStore(connectClaudeStore, selector);
}
