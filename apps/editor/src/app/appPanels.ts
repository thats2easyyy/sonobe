/** App-wide open state for the Settings, About, and Keyboard Shortcuts dialogs (menus, the palette, and the welcome screen open them). */

import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

export type AppPanel = "settings" | "about" | "shortcuts";

export interface AppPanelsState {
  open: AppPanel | null;
  show: (panel: AppPanel) => void;
  hide: () => void;
}

export function createAppPanelsStore(): StoreApi<AppPanelsState> {
  return createStore<AppPanelsState>()((set) => ({
    open: null,
    show: (panel) => set({ open: panel }),
    hide: () => set({ open: null }),
  }));
}

export const appPanels = createAppPanelsStore();

export function useAppPanels<T>(selector: (state: AppPanelsState) => T): T {
  return useStore(appPanels, selector);
}
