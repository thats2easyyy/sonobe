/** Where the Learn drawer should navigate: set by "Learn More" in the inspector, Connect Claude guides, and commands. */

import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { LearnView } from "../panels/learn/learnStorage.ts";
import { layoutStore } from "../shell/layoutStore.ts";

export interface LearnNavState {
  /** The last requested view (undefined: the drawer's own last view). */
  view: LearnView | undefined;
  /** Open the Learn drawer, optionally at a view. */
  open: (view?: LearnView) => void;
}

export function createLearnNavStore(layout: Pick<typeof layoutStore, "getState"> = layoutStore): StoreApi<LearnNavState> {
  return createStore<LearnNavState>()((set) => ({
    view: undefined,
    open(view) {
      if (view) set({ view });
      layout.getState().setDrawer("learn");
    },
  }));
}

export const learnNav = createLearnNavStore();

export function useLearnNav<T>(selector: (state: LearnNavState) => T): T {
  return useStore(learnNav, selector);
}
