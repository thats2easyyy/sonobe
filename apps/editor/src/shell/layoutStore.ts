/**
 * Shell layout state: panel sizes, collapsed panels, view mode, split direction, drawers, and the
 * HUD tab. Persisted to localStorage (debounced; storage failures are ignored).
 */

import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { readJSON, writeJSON } from "../ui/lib/storage.ts";

export type ViewMode = "canvas" | "split" | "patches";
/** "rows": canvas above the patch editor. "columns": side by side. */
export type SplitDirection = "rows" | "columns";
export type DrawerId = "learn";
export type HudTab = "console" | "diagnostics" | "ai" | "performance";
export type CollapsiblePanel = "layers" | "viewer" | "inspector" | "hud";
export type SizedPanel = "layers" | "viewer" | "inspector" | "hud" | "drawer";

export interface LayoutState {
  sizes: Record<SizedPanel, number>;
  /** Canvas share of the center area in split mode (0..1). */
  split: number;
  collapsed: Record<CollapsiblePanel, boolean>;
  viewMode: ViewMode;
  splitDirection: SplitDirection;
  drawer: DrawerId | null;
  hudTab: HudTab;
}

export interface LayoutActions {
  setSize: (panel: SizedPanel, size: number) => void;
  setSplit: (ratio: number) => void;
  toggleCollapsed: (panel: CollapsiblePanel, collapsed?: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleSplitDirection: () => void;
  setDrawer: (drawer: DrawerId | null) => void;
  toggleDrawer: (drawer: DrawerId) => void;
  setHudTab: (tab: HudTab) => void;
  reset: () => void;
}

export type LayoutStore = LayoutState & LayoutActions;

export const LAYOUT_STORAGE_KEY = "sonobe.editor.layout.v1";

export const SIZE_LIMITS: Record<SizedPanel, readonly [number, number]> = {
  layers: [180, 420],
  viewer: [240, 640],
  inspector: [240, 440],
  hud: [120, 520],
  drawer: [300, 560],
};

export const SPLIT_LIMITS = [0.15, 0.85] as const;

export const DEFAULT_LAYOUT: LayoutState = {
  sizes: { layers: 232, viewer: 296, inspector: 272, hud: 164, drawer: 360 },
  split: 0.5,
  collapsed: { layers: false, viewer: false, inspector: false, hud: false },
  viewMode: "split",
  splitDirection: "rows",
  drawer: null,
  hudTab: "console",
};

const VIEW_MODES: readonly ViewMode[] = ["canvas", "split", "patches"];
const DRAWERS: readonly DrawerId[] = ["learn"];
const HUD_TABS: readonly HudTab[] = ["console", "diagnostics", "ai", "performance"];

const clampRange = (value: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, value));

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

/** Coerce anything (e.g. stale or hand-edited storage) into a valid layout. */
export function sanitizeLayout(input: unknown): LayoutState {
  const src = record(input);
  const sizesIn = record(src.sizes);
  const collapsedIn = record(src.collapsed);
  const sizes = { ...DEFAULT_LAYOUT.sizes };
  for (const key of Object.keys(SIZE_LIMITS) as SizedPanel[]) {
    const v = sizesIn[key];
    if (typeof v === "number" && Number.isFinite(v)) sizes[key] = Math.round(clampRange(v, SIZE_LIMITS[key]));
  }
  const collapsed = { ...DEFAULT_LAYOUT.collapsed };
  for (const key of Object.keys(collapsed) as CollapsiblePanel[]) {
    if (typeof collapsedIn[key] === "boolean") collapsed[key] = collapsedIn[key] as boolean;
  }
  return {
    sizes,
    split: typeof src.split === "number" && Number.isFinite(src.split) ? clampRange(src.split, SPLIT_LIMITS) : DEFAULT_LAYOUT.split,
    collapsed,
    viewMode: VIEW_MODES.includes(src.viewMode as ViewMode) ? (src.viewMode as ViewMode) : DEFAULT_LAYOUT.viewMode,
    splitDirection: src.splitDirection === "columns" ? "columns" : "rows",
    drawer: DRAWERS.includes(src.drawer as DrawerId) ? (src.drawer as DrawerId) : null,
    hudTab: HUD_TABS.includes(src.hudTab as HudTab) ? (src.hudTab as HudTab) : DEFAULT_LAYOUT.hudTab,
  };
}

export function pickLayout(state: LayoutState): LayoutState {
  const { sizes, split, collapsed, viewMode, splitDirection, drawer, hudTab } = state;
  return { sizes, split, collapsed, viewMode, splitDirection, drawer, hudTab };
}

export interface LayoutStoreOptions {
  /** null disables persistence. */
  storageKey?: string | null;
  persistDelayMs?: number;
}

export function createLayoutStore(options: LayoutStoreOptions = {}): StoreApi<LayoutStore> {
  const key = options.storageKey === undefined ? LAYOUT_STORAGE_KEY : options.storageKey;
  const initial = key ? sanitizeLayout(readJSON(key, (v): v is unknown => v !== null)) : DEFAULT_LAYOUT;
  const store = createStore<LayoutStore>()((set) => ({
    ...initial,
    setSize: (panel, size) =>
      set((s) => {
        const next = Math.round(clampRange(size, SIZE_LIMITS[panel]));
        return s.sizes[panel] === next ? s : { sizes: { ...s.sizes, [panel]: next } };
      }),
    setSplit: (ratio) => set((s) => (s.split === ratio ? s : { split: clampRange(ratio, SPLIT_LIMITS) })),
    toggleCollapsed: (panel, value) => set((s) => ({ collapsed: { ...s.collapsed, [panel]: value ?? !s.collapsed[panel] } })),
    setViewMode: (viewMode) => set({ viewMode }),
    toggleSplitDirection: () => set((s) => ({ splitDirection: s.splitDirection === "rows" ? "columns" : "rows" })),
    setDrawer: (drawer) => set({ drawer }),
    toggleDrawer: (drawer) => set((s) => ({ drawer: s.drawer === drawer ? null : drawer })),
    setHudTab: (hudTab) => set((s) => ({ hudTab, collapsed: s.collapsed.hud ? { ...s.collapsed, hud: false } : s.collapsed })),
    reset: () => set({ ...DEFAULT_LAYOUT }),
  }));
  if (key) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    store.subscribe((state) => {
      clearTimeout(timer);
      timer = setTimeout(() => writeJSON(key, pickLayout(state)), options.persistDelayMs ?? 200);
    });
  }
  return store;
}

/** The editor's layout store. */
export const layoutStore = createLayoutStore();

export function useLayout<T>(selector: (state: LayoutStore) => T): T {
  return useStore(layoutStore, selector);
}
