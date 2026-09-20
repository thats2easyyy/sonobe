/**
 * Per-session Knobs UI state that isn't the document's: the partner preset (the one that ran before,
 * which ticks, ≠ marks and Flip Presets compare against), the "Only differences" filter, collapsed
 * groups, the row to flash, and requests from commands for the panel (New Knob…, Convert…).
 */

import type { Id } from "@sonobe/core";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { layoutStore } from "../../shell/layoutStore.ts";
import type { EditorSession } from "../../state/session.ts";

export type KnobsRequest = { kind: "newKnob" } | { kind: "editKnob"; id: Id } | { kind: "convert" };

export interface KnobsUiState {
  /** The preset that ran before the running one (Flip Presets goes back to it). */
  partner: Id | null;
  onlyDifferences: boolean;
  /** Collapsed group names (for this session only). */
  collapsed: ReadonlySet<string>;
  /** A row to scroll to and flash (Show in Knobs, a patch editor chip, a diagnostic). */
  flash: { id: Id; at: number } | null;
  /** What a command asked the panel to open. */
  request: KnobsRequest | null;
  /** The group Make Knob offered last. */
  lastGroup: string | null;
  set: (partial: Partial<Omit<KnobsUiState, "set" | "toggleGroup">>) => void;
  toggleGroup: (name: string) => void;
}

export type KnobsUiStore = StoreApi<KnobsUiState>;

const stores = new WeakMap<EditorSession, KnobsUiStore>();

/** The session's Knobs UI store. The first call starts following preset switches, so the partner is the preset that ran before, whoever switched. */
export function knobsUi(session: EditorSession): KnobsUiStore {
  let store = stores.get(session);
  if (store) return store;
  const created = createStore<KnobsUiState>()((set) => ({
    partner: null,
    onlyDifferences: false,
    collapsed: new Set(),
    flash: null,
    request: null,
    lastGroup: null,
    set: (partial) => set(partial),
    toggleGroup: (name) =>
      set((s) => {
        const collapsed = new Set(s.collapsed);
        if (!collapsed.delete(name)) collapsed.add(name);
        return { collapsed };
      }),
  }));
  session.document.getState().subscribeRevision((next, previous) => {
    if (next.lastChange?.kind === "replace") {
      created.setState({ partner: null, flash: null });
      return;
    }
    const before = previous.doc.knobs?.active;
    const after = next.doc.knobs?.active;
    if (before && after && before !== after) created.setState({ partner: before });
  });
  stores.set(session, created);
  store = created;
  return store;
}

export function useKnobsUi<T>(session: EditorSession, selector: (state: KnobsUiState) => T): T {
  return useStore(knobsUi(session), selector);
}

/** Open the Inspector on its Knobs tab, flashing `knobId`'s row when given. */
export function showKnobs(session: EditorSession, knobId?: Id, request?: KnobsRequest): void {
  const layout = layoutStore.getState();
  if (layout.collapsed.inspector) layout.toggleCollapsed("inspector", false);
  layout.setInspectorTab("knobs");
  const ui = knobsUi(session).getState();
  if (knobId !== undefined) ui.set({ flash: { id: knobId, at: Date.now() } });
  if (request) ui.set({ request });
}
