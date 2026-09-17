/**
 * Editor selection: the component path (enter/exit component, breadcrumbs), selected layers,
 * patches, and comments in the current component, the hovered item for cross-highlighting between
 * layers, patches, and the viewer, the focused panel, and per-component viewports. `prune` drops
 * ids that no longer exist after a document change.
 */

import { findLayer, type Component, type Id, type SonobeDocument } from "@sonobe/core";
import { createStore, type StoreApi } from "zustand/vanilla";

export type ItemKind = "layer" | "patch" | "comment";

export type PanelId = "layers" | "canvas" | "patchEditor" | "viewer" | "inspector" | "hud" | "assistant" | "learn";

export type SelectMode = "replace" | "add" | "toggle" | "remove";

export interface HoveredItem {
  kind: ItemKind | "port";
  /** Item id (for ports, the patch or layer id). */
  id: Id;
  component: Id;
  /** Port address when kind is "port" ("pop.output", "@card.scale"). */
  address?: string;
  /** Where the hover happened, so a panel doesn't echo its own highlight. */
  source: PanelId | "agent";
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface RevealRequest {
  component: Id;
  ids: Id[];
  /** Increments per request so panels can react to repeated reveals of the same ids. */
  nonce: number;
}

export interface SelectionItems {
  layers?: readonly Id[];
  patches?: readonly Id[];
  comments?: readonly Id[];
}

export interface Breadcrumb {
  id: Id;
  name: string;
  kind: Component["kind"];
  /** Path up to and including this component. */
  path: Id[];
}

export interface SelectionState {
  /** Root component first; the last entry is the component being edited. */
  componentPath: Id[];
  layers: Id[];
  patches: Id[];
  comments: Id[];
  hovered: HoveredItem | null;
  focusedPanel: PanelId | null;
  patchViewports: Record<Id, Viewport>;
  canvasViewports: Record<Id, Viewport>;
  reveal: RevealRequest | null;

  select: (items: SelectionItems, mode?: SelectMode) => void;
  selectItem: (kind: ItemKind, id: Id, mode?: SelectMode) => void;
  clear: () => void;
  /** Enter a component (pushed onto the path). Clears the selection. */
  enterComponent: (componentId: Id) => void;
  /** Leave the current component; selects the instance you came from when given. */
  exitComponent: (select?: SelectionItems) => void;
  setComponentPath: (path: readonly Id[]) => void;
  setHovered: (hovered: HoveredItem | null) => void;
  setFocusedPanel: (panel: PanelId | null) => void;
  setPatchViewport: (componentId: Id, viewport: Viewport) => void;
  setCanvasViewport: (componentId: Id, viewport: Viewport) => void;
  requestReveal: (component: Id, ids: readonly Id[]) => void;
  /** Drop components and ids that don't exist in `doc`. No-op (no store update) when nothing changed. */
  prune: (doc: SonobeDocument) => void;
}

export type SelectionStore = StoreApi<SelectionState>;

const KEYS: Record<ItemKind, "layers" | "patches" | "comments"> = { layer: "layers", patch: "patches", comment: "comments" };

function combine(current: readonly Id[], ids: readonly Id[] | undefined, mode: SelectMode): Id[] {
  const incoming = [...new Set(ids ?? [])];
  switch (mode) {
    case "replace":
      return incoming;
    case "add":
      return [...current, ...incoming.filter((id) => !current.includes(id))];
    case "remove":
      return current.filter((id) => !incoming.includes(id));
    case "toggle": {
      const out = current.filter((id) => !incoming.includes(id));
      for (const id of incoming) if (!current.includes(id)) out.push(id);
      return out;
    }
  }
}

const sameList = (a: readonly Id[], b: readonly Id[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** The component being edited. */
export function currentComponentId(state: Pick<SelectionState, "componentPath">): Id {
  return state.componentPath.at(-1) ?? "main";
}

export function hasSelection(state: Pick<SelectionState, "layers" | "patches" | "comments">): boolean {
  return state.layers.length > 0 || state.patches.length > 0 || state.comments.length > 0;
}

export function isSelected(state: Pick<SelectionState, "layers" | "patches" | "comments">, kind: ItemKind, id: Id): boolean {
  return state[KEYS[kind]].includes(id);
}

/** Breadcrumbs for the component path (missing components are skipped). */
export function selectBreadcrumbs(state: Pick<SelectionState, "componentPath">, doc: SonobeDocument): Breadcrumb[] {
  const out: Breadcrumb[] = [];
  state.componentPath.forEach((id, i) => {
    const c = doc.components[id];
    if (c) out.push({ id, name: c.name, kind: c.kind, path: state.componentPath.slice(0, i + 1) });
  });
  return out;
}

/** Which kind of item an id names in a component. */
export function itemKindOf(component: Component | undefined, id: Id): ItemKind | undefined {
  if (!component) return undefined;
  if (id in component.patches) return "patch";
  if (findLayer(component.layers, id)) return "layer";
  if (component.comments.some((c) => c.id === id)) return "comment";
  return undefined;
}

export interface SelectionStoreOptions {
  /** Root component id. Default "main". */
  root?: Id;
}

export function createSelectionStore(options: SelectionStoreOptions = {}): SelectionStore {
  let revealCounter = 0;
  return createStore<SelectionState>()((set, get) => ({
    componentPath: [options.root ?? "main"],
    layers: [],
    patches: [],
    comments: [],
    hovered: null,
    focusedPanel: null,
    patchViewports: {},
    canvasViewports: {},
    reveal: null,

    select(items, mode = "replace") {
      const s = get();
      const next = {
        layers: items.layers !== undefined || mode === "replace" ? combine(s.layers, items.layers, mode) : s.layers,
        patches: items.patches !== undefined || mode === "replace" ? combine(s.patches, items.patches, mode) : s.patches,
        comments: items.comments !== undefined || mode === "replace" ? combine(s.comments, items.comments, mode) : s.comments,
      };
      if (sameList(next.layers, s.layers) && sameList(next.patches, s.patches) && sameList(next.comments, s.comments)) return;
      set(next);
    },
    selectItem(kind, id, mode = "replace") {
      get().select({ [KEYS[kind]]: [id] }, mode);
    },
    clear() {
      if (hasSelection(get())) set({ layers: [], patches: [], comments: [] });
    },
    enterComponent(componentId) {
      const path = get().componentPath;
      if (path.at(-1) === componentId) return;
      const existing = path.indexOf(componentId);
      set({ componentPath: existing >= 0 ? path.slice(0, existing + 1) : [...path, componentId], layers: [], patches: [], comments: [], hovered: null });
    },
    exitComponent(select) {
      const path = get().componentPath;
      if (path.length <= 1) return;
      set({ componentPath: path.slice(0, -1), layers: [...(select?.layers ?? [])], patches: [...(select?.patches ?? [])], comments: [...(select?.comments ?? [])], hovered: null });
    },
    setComponentPath(path) {
      if (path.length === 0 || sameList(path, get().componentPath)) return;
      set({ componentPath: [...path], layers: [], patches: [], comments: [], hovered: null });
    },
    setHovered(hovered) {
      const prev = get().hovered;
      if (prev === hovered) return;
      if (prev && hovered && prev.kind === hovered.kind && prev.id === hovered.id && prev.component === hovered.component && prev.address === hovered.address && prev.source === hovered.source) return;
      set({ hovered });
    },
    setFocusedPanel(panel) {
      if (get().focusedPanel !== panel) set({ focusedPanel: panel });
    },
    setPatchViewport(componentId, viewport) {
      set({ patchViewports: { ...get().patchViewports, [componentId]: { ...viewport } } });
    },
    setCanvasViewport(componentId, viewport) {
      set({ canvasViewports: { ...get().canvasViewports, [componentId]: { ...viewport } } });
    },
    requestReveal(component, ids) {
      set({ reveal: { component, ids: [...ids], nonce: ++revealCounter } });
    },
    prune(doc) {
      const s = get();
      const root = doc.project.root;
      let path: Id[] = [root];
      if (s.componentPath[0] === root) {
        path = [];
        for (const id of s.componentPath) {
          if (!doc.components[id]) break;
          path.push(id);
        }
      }
      const pathChanged = !sameList(path, s.componentPath);
      const component = doc.components[path.at(-1)!];
      const existsLayer = (id: Id) => !!component && !!findLayer(component.layers, id);
      const layers = pathChanged ? [] : s.layers.filter(existsLayer);
      const patches = pathChanged ? [] : s.patches.filter((id) => !!component && id in component.patches);
      const comments = pathChanged ? [] : s.comments.filter((id) => !!component && component.comments.some((c) => c.id === id));
      let hovered = s.hovered;
      if (hovered) {
        const hc = doc.components[hovered.component];
        const alive = hovered.kind === "port" ? !!itemKindOf(hc, hovered.id) : itemKindOf(hc, hovered.id) === hovered.kind;
        if (!alive) hovered = null;
      }
      const prune = (vps: Record<Id, Viewport>) => {
        const keys = Object.keys(vps).filter((id) => doc.components[id]);
        return keys.length === Object.keys(vps).length ? vps : Object.fromEntries(keys.map((k) => [k, vps[k]!]));
      };
      const patchViewports = prune(s.patchViewports);
      const canvasViewports = prune(s.canvasViewports);
      const reveal = s.reveal && !doc.components[s.reveal.component] ? null : s.reveal;
      if (
        !pathChanged &&
        sameList(layers, s.layers) &&
        sameList(patches, s.patches) &&
        sameList(comments, s.comments) &&
        hovered === s.hovered &&
        patchViewports === s.patchViewports &&
        canvasViewports === s.canvasViewports &&
        reveal === s.reveal
      ) {
        return;
      }
      set({ componentPath: path, layers, patches, comments, hovered, patchViewports, canvasViewports, reveal });
    },
  }));
}
