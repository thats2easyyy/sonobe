/**
 * Room for Design with Claude. While the box is open, or an MCP client such as Claude Code is writing
 * a draft, the canvas shows (a patches-only layout becomes the split) and takes most of a split over
 * the patch editor, which stays as a strip. It's a temporary layout, never saved: when the box closes,
 * or the draft ends without an import, what it changed goes back, unless the person changed it
 * meanwhile. A draft that ends in an import with the box closed keeps the room, handed to the person,
 * so nothing jumps just as the screen lands.
 */

import type { StoreApi } from "zustand/vanilla";
import type { LayoutStore } from "../../shell/layoutStore.ts";
import { designStore, mcpDraftIdleAt, type DesignData, type DesignDraft, type DesignState } from "./designStore.ts";

/** The canvas's share of a split over the patch editor while it has the room. */
export const DESIGN_CANVAS_SPLIT = 0.8;

/** MCP clients' drafts being written or added, less those gone idle (mcpDraftIdleAt: they've left the canvas). */
export function liveMcpDrafts(state: DesignData, now: number): DesignDraft[] {
  return state.drafts.filter((d) => (d.status === "writing" || d.status === "adding") && now < (mcpDraftIdleAt(d) ?? -Infinity));
}

function makeRoom(layout: StoreApi<LayoutStore>): void {
  const { viewMode, splitDirection, split } = layout.getState();
  const mode = viewMode === "patches" ? "split" : viewMode;
  layout.getState().showTemporary({
    ...(mode !== viewMode ? { viewMode: mode } : {}),
    ...(mode === "split" && splitDirection === "rows" && split < DESIGN_CANVAS_SPLIT ? { split: DESIGN_CANVAS_SPLIT } : {}),
  });
}

/** Give the canvas room in the shell layout while the box is open or an MCP draft is live. Returns unsubscribe. */
export function followDesignBox(layout: StoreApi<LayoutStore>, design: StoreApi<DesignState> = designStore): () => void {
  // What the last check saw: whether the canvas had the room, the box was open, and which MCP drafts were live.
  let room = false;
  let open = false;
  let drafting: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const check = () => {
    clearTimeout(timer);
    timer = undefined;
    const state = design.getState();
    const now = Date.now();
    const live = liveMcpDrafts(state, now);
    // A draft goes idle without a store change: look again then.
    if (live.length) timer = setTimeout(check, Math.min(...live.map((d) => mcpDraftIdleAt(d)!)) - now + 1);
    const wants = state.open || live.length > 0;
    if (wants && !room) makeRoom(layout);
    else if (!wants && room) {
      const imported = !open && drafting.some((key) => state.drafts.find((d) => d.key === key)?.status === "added");
      layout.getState().endTemporary(!imported);
    }
    room = wants;
    open = state.open;
    drafting = live.map((d) => d.key);
  };

  const unsubscribe = design.subscribe(check);
  check();
  return () => {
    unsubscribe();
    clearTimeout(timer);
  };
}
