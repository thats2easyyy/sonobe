/**
 * Design with Claude state: whether the canvas's box is open, the request it sent, the drafts Claude
 * is writing (import_design's html, before the tool runs), and the last result. `reduceDesignEvent`
 * folds Assistant events into it and is pure. A draft is keyed by its toolUseId, whatever sent it.
 */

import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { EditorSession } from "../../state/session.ts";
import type { AssistantCanvasContext, AssistantDesignFields, AssistantEvent, AssistantHostLike } from "../assistant/types.ts";

export type DraftStatus = "writing" | "adding" | "added" | "failed" | "stopped";
export interface DesignDraft {
  runId: string; turn: number; toolUseId: string;
  html: string; fields: AssistantDesignFields;
  status: DraftStatus; since: number;
  /** tool_progress while adding ("Downloading images: 3 of 7"). */
  progress: string | null;
  /** failed: "too_long" (max_tokens) or the tool's detail. */
  error: string | null;
  /** An append arrived at the wrong offset; wait for done's html. */
  resync: boolean;
}
export interface DesignRequest { runId: string | null; text: string; context: AssistantCanvasContext; selection: readonly string[] }
export interface DesignResult { kind: "added" | "updated"; layerId: string; component: string; name: string; txnId: string | null; dropped: string[]; droppedCount: number; coveredScreen: string | null; reply: string }
export interface DesignData { open: boolean; newScreen: boolean; request: DesignRequest | null; drafts: DesignDraft[]; result: DesignResult | null }
export interface DesignState extends DesignData { openBox(): void; closeBox(): void; setNewScreen(value: boolean): void }

export function initialDesignData(): DesignData {
  return { open: false, newScreen: false, request: null, drafts: [], result: null };
}

/** The app-wide Design with Claude store (the canvas header, ⌘K, the Layers menu and the box share it). */
export const designStore: StoreApi<DesignState> = createStore<DesignState>()((set) => ({
  ...initialDesignData(),
  openBox: () => set({ open: true }),
  closeBox: () => set({ open: false }),
  setNewScreen: (value) => set({ newScreen: value }),
}));

export function useDesign<T>(selector: (s: DesignState) => T): T {
  return useStore(designStore, selector);
}

/** Fold one Assistant event into design state. Pure. */
export function reduceDesignEvent(_state: DesignData, _event: AssistantEvent, _now: number): Partial<DesignData> {
  throw new Error("not implemented");
}

/** The draft the canvas previews: the newest writing/adding one, else one that left those states < 400 ms ago (the fade). */
export function activeDraft(_state: DesignData, _now: number): DesignDraft | null {
  throw new Error("not implemented");
}

/** Subscribe to host.assistant.onEvent (default getAssistantHost()); on tool_finished.imported, select and reveal the screen when it's in the current component and the selection hasn't changed since the run started; set result. Returns detach. */
export function attachDesign(_session: EditorSession, _host?: AssistantHostLike | null): () => void {
  throw new Error("not implemented");
}

/** Send the box's text with the canvas context through sharedAssistantController(). */
export function sendDesign(_session: EditorSession, _text: string, _bounds: (id: string) => { x: number; y: number; width: number; height: number } | null): Promise<void> {
  throw new Error("not implemented");
}
