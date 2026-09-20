/**
 * When the import hologram plays. Imports through the dialog and pasted captures ask for it from
 * importCapture; Claude's import_design lands as an agent change labeled "imported …" or
 * "re-imported …", which watchAgentImports turns into the same request. The canvas that draws the
 * component takes the request and plays it; a request nobody takes soon goes stale.
 */

import type { Id, LayerNode, SonobeDocument } from "@sonobe/core";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { DocumentChange } from "../../state/document.ts";
import type { EditorSession } from "../../state/session.ts";

export interface HologramTarget {
  componentId: Id;
  /** The imported screen: the layer whose bounds the hologram covers. */
  screenId: Id;
}

export interface HologramRequest extends HologramTarget {
  /** Tells requests apart. */
  nonce: number;
  /** performance.now() when it was asked for. */
  at: number;
}

export interface HologramState {
  request: HologramRequest | null;
  /** Play the hologram over a screen that was just imported. */
  build(target: HologramTarget): void;
  /** The canvas took the request (or dropped it). */
  take(nonce: number): void;
}

/** A request the canvas hasn't taken within this long is dropped: the screen wasn't on screen. */
export const HOLOGRAM_STALE_MS = 1000;

const now = () => (typeof performance !== "undefined" ? performance.now() : 0);

export function createHologramStore(): StoreApi<HologramState> {
  let nonce = 0;
  return createStore<HologramState>()((set, get) => ({
    request: null,
    build: (target) => set({ request: { ...target, nonce: ++nonce, at: now() } }),
    take: (n) => {
      if (get().request?.nonce === n) set({ request: null });
    },
  }));
}

const stores = new WeakMap<EditorSession, StoreApi<HologramState>>();

/** The session's hologram requests. */
export function hologramStore(session: EditorSession): StoreApi<HologramState> {
  let store = stores.get(session);
  if (!store) {
    store = createHologramStore();
    stores.set(session, store);
  }
  return store;
}

/** "imported Profile", "re-imported Profile", "Import “Profile”": but not "important" or "Paste". */
export const IMPORT_LABEL = /^(re-?)?import(s|ed|ing)?\b/i;

/** An agent's change that imported a design (Claude's import_design). */
export function isAgentImport(change: DocumentChange | null | undefined): change is DocumentChange {
  return !!change && change.kind === "apply" && change.author.kind === "agent" && IMPORT_LABEL.test(change.label.trim());
}

/**
 * The screen a change imported: of the layers it touched that still exist, the outermost one holding
 * the most of them (a screen and everything in it, not a layer elsewhere whose link it dropped).
 */
export function importedScreen(doc: SonobeDocument, change: Pick<DocumentChange, "affected">): HologramTarget | null {
  const affected = new Set(change.affected.layers);
  if (affected.size === 0) return null;
  let best: { componentId: Id; screenId: Id; count: number } | null = null;
  const count = (layer: LayerNode): number => (affected.has(layer.id) ? 1 : 0) + (layer.children ?? []).reduce((sum, child) => sum + count(child), 0);
  for (const componentId of change.affected.components) {
    const component = doc.components[componentId];
    if (!component || component.kind === "patchComponent") continue;
    const visit = (layers: readonly LayerNode[]) => {
      for (const layer of layers) {
        if (!affected.has(layer.id)) {
          if (layer.children?.length) visit(layer.children);
          continue;
        }
        const n = count(layer);
        if (!best || n > best.count) best = { componentId, screenId: layer.id, count: n };
      }
    };
    visit(component.layers);
  }
  const found = best as { componentId: Id; screenId: Id } | null;
  return found ? { componentId: found.componentId, screenId: found.screenId } : null;
}

/** Play the hologram for Claude's imports. Returns the unsubscribe. */
export function watchAgentImports(session: EditorSession): () => void {
  return session.document.getState().subscribeRevision((state, previous) => {
    const change = state.lastChange;
    if (change === previous.lastChange || !isAgentImport(change)) return;
    const target = importedScreen(state.doc, change);
    if (target) hologramStore(session).getState().build(target);
  });
}
