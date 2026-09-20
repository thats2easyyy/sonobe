/**
 * Room for the Design with Claude box. It floats over the canvas, so while it's open the canvas shows
 * (a patches-only layout becomes the split) and, above the patch editor, takes the larger share of the
 * split. Closing the box puts back what opening it changed, unless the person changed it meanwhile.
 */

import type { StoreApi } from "zustand/vanilla";
import type { LayoutStore, ViewMode } from "../../shell/layoutStore.ts";
import { designStore, type DesignState } from "./designStore.ts";

/** The canvas's share of a split over the patch editor while the box is open. */
export const DESIGN_CANVAS_SPLIT = 0.62;

/** Follow the box's open state in the shell layout. Returns unsubscribe. */
export function followDesignBox(layout: StoreApi<LayoutStore>, design: StoreApi<DesignState> = designStore): () => void {
  let restore: { viewMode?: ViewMode; split?: { from: number; to: number } } | null = null;
  return design.subscribe((state, previous) => {
    if (state.open === previous.open) return;
    if (state.open) {
      restore = {};
      if (layout.getState().viewMode === "patches") {
        restore.viewMode = "patches";
        layout.getState().setViewMode("split");
      }
      const { viewMode, splitDirection, split } = layout.getState();
      if (viewMode === "split" && splitDirection === "rows" && split < DESIGN_CANVAS_SPLIT) {
        restore.split = { from: split, to: DESIGN_CANVAS_SPLIT };
        layout.getState().setSplit(DESIGN_CANVAS_SPLIT);
      }
      return;
    }
    const changed = restore;
    restore = null;
    if (changed?.split && layout.getState().split === changed.split.to) layout.getState().setSplit(changed.split.from);
    if (changed?.viewMode && layout.getState().viewMode === "split") layout.getState().setViewMode(changed.viewMode);
  });
}
