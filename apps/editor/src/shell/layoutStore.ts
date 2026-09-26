/**
 * Shell layout state: panel sizes, collapsed panels, view mode, split direction, drawers, the HUD
 * tab, and the Inspector tab. Persisted to localStorage (debounced; storage failures are ignored).
 * A temporary layout is saved as what it replaced, so a reload never keeps it.
 */

import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { readJSON, writeJSON } from "../ui/lib/storage.ts";

export type ViewMode = "canvas" | "split" | "patches";
/** "rows": canvas above the patch editor. "columns": side by side. */
export type SplitDirection = "rows" | "columns";
export type DrawerId = "learn";
export type HudTab = "console" | "diagnostics" | "ai" | "performance";
/** The Inspector shows the selection's properties, or the project's knobs (it stays there as the selection changes). */
export type InspectorTab = "properties" | "knobs";
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
  inspectorTab: InspectorTab;
}

/**
 * Values shown for a while in place of the person's own (Design with Claude's room for the canvas,
 * panels/design/layout.ts), and what they replaced.
 */
export interface TemporaryLayout {
  viewMode?: { from: ViewMode; to: ViewMode };
  split?: { from: number; to: number };
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
  setInspectorTab: (tab: InspectorTab) => void;
  /** Show these values for a while. Until endTemporary, each is saved as what it replaced while it still shows. */
  showTemporary: (values: Partial<Pick<LayoutState, "viewMode" | "split">>) => void;
  /** End the temporary layout: put back each value that still shows, or (restore false) keep them as the person's own. */
  endTemporary: (restore: boolean) => void;
  reset: () => void;
}

export type LayoutStore = LayoutState & LayoutActions & { temporary: TemporaryLayout | null };

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
  sizes: { layers: 232, viewer: 296, inspector: 272, hud: 200, drawer: 360 },
  // The patch editor gets the larger share, and the console starts as a tab strip (it opens on the first error).
  split: 0.42,
  collapsed: { layers: false, viewer: false, inspector: false, hud: true },
  viewMode: "split",
  splitDirection: "rows",
  drawer: null,
  hudTab: "console",
  inspectorTab: "properties",
};

/** Width of a collapsed panel's rail and of the splitter that sits beside an open one. */
const RAIL_WIDTH = 36;
const SPLITTER_WIDTH = 1;
/** The centre (canvas and patch editor) keeps at least this much before the Viewer gives way. */
export const MIN_CENTER_WIDTH = 400;

type FittedPanel = "layers" | "viewer" | "inspector";

export interface FittedPanels {
  sizes: Record<FittedPanel, number>;
  /** The Viewer shows as a rail because the window is too narrow for it, though the person hasn't collapsed it. */
  viewerAuto: boolean;
  /** Width left for the centre. */
  center: number;
}

/**
 * The panel widths that fit `available` px (the shell row). The Viewer shrinks toward its minimum
 * first, then Layers, then the Inspector; if the centre would still be under `minCenter`, the Viewer
 * becomes a rail (`viewerAuto`) and the others shrink instead. `keepViewer` refuses that and keeps
 * the Viewer open at its smallest, for a person who asked for it. Nothing here is saved.
 */
export function fitPanelWidths(sizes: Pick<LayoutState["sizes"], FittedPanel>, collapsed: Pick<LayoutState["collapsed"], FittedPanel>, available: number, minCenter = MIN_CENTER_WIDTH, keepViewer = false): FittedPanels {
  const fit = (viewerHidden: boolean) => {
    const hidden: Record<FittedPanel, boolean> = { layers: collapsed.layers, viewer: viewerHidden, inspector: collapsed.inspector };
    const widths = { layers: sizes.layers, viewer: sizes.viewer, inspector: sizes.inspector };
    let excess = minCenter - available;
    for (const panel of ["layers", "viewer", "inspector"] as const) excess += hidden[panel] ? RAIL_WIDTH : widths[panel] + SPLITTER_WIDTH;
    for (const panel of ["viewer", "layers", "inspector"] as const) {
      if (hidden[panel] || excess <= 0) continue;
      const cut = Math.min(excess, Math.max(0, widths[panel] - SIZE_LIMITS[panel][0]));
      widths[panel] -= cut;
      excess -= cut;
    }
    return { widths, excess };
  };
  const natural = fit(collapsed.viewer);
  const auto = !collapsed.viewer && !keepViewer && natural.excess > 0;
  const { widths, excess } = auto ? fit(true) : natural;
  return { sizes: widths, viewerAuto: auto, center: minCenter - excess };
}

/** How far a drawer floating over the panels reaches past the Inspector's slot: the centre column gives up this much, so the drawer never covers half of one of its header actions. */
export function drawerOverhang(drawerWidth: number, inspectorSize: number, inspectorCollapsed: boolean): number {
  return Math.max(0, drawerWidth - (inspectorCollapsed ? RAIL_WIDTH : inspectorSize + SPLITTER_WIDTH));
}

const VIEW_MODES: readonly ViewMode[] = ["canvas", "split", "patches"];
const DRAWERS: readonly DrawerId[] = ["learn"];
const HUD_TABS: readonly HudTab[] = ["console", "diagnostics", "ai", "performance"];
const INSPECTOR_TABS: readonly InspectorTab[] = ["properties", "knobs"];

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
    inspectorTab: INSPECTOR_TABS.includes(src.inspectorTab as InspectorTab) ? (src.inspectorTab as InspectorTab) : DEFAULT_LAYOUT.inspectorTab,
  };
}

export function pickLayout(state: LayoutState): LayoutState {
  const { sizes, split, collapsed, viewMode, splitDirection, drawer, hudTab, inspectorTab } = state;
  return { sizes, split, collapsed, viewMode, splitDirection, drawer, hudTab, inspectorTab };
}

/** What's saved: the layout, with each temporary value that still shows saved as what it replaced. */
export function savedLayout(state: LayoutState & { temporary?: TemporaryLayout | null }): LayoutState {
  const layout = pickLayout(state);
  const temporary = state.temporary;
  if (temporary?.viewMode && layout.viewMode === temporary.viewMode.to) layout.viewMode = temporary.viewMode.from;
  if (temporary?.split && layout.split === temporary.split.to) layout.split = temporary.split.from;
  return layout;
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
    temporary: null,
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
    setInspectorTab: (inspectorTab) => set((s) => (s.inspectorTab === inspectorTab ? s : { inspectorTab })),
    showTemporary: (values) =>
      set((s) => {
        const temporary: TemporaryLayout = {};
        if (values.viewMode !== undefined && values.viewMode !== s.viewMode) temporary.viewMode = { from: s.viewMode, to: values.viewMode };
        const split = values.split === undefined ? s.split : clampRange(values.split, SPLIT_LIMITS);
        if (split !== s.split) temporary.split = { from: s.split, to: split };
        return { ...(temporary.viewMode ? { viewMode: temporary.viewMode.to } : {}), ...(temporary.split ? { split } : {}), temporary };
      }),
    endTemporary: (restore) =>
      set((s) => {
        const t = s.temporary;
        if (!t) return s;
        if (!restore) return { temporary: null };
        return { temporary: null, ...(t.split && s.split === t.split.to ? { split: t.split.from } : {}), ...(t.viewMode && s.viewMode === t.viewMode.to ? { viewMode: t.viewMode.from } : {}) };
      }),
    reset: () => set({ ...DEFAULT_LAYOUT, temporary: null }),
  }));
  if (key) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    store.subscribe((state) => {
      clearTimeout(timer);
      timer = setTimeout(() => writeJSON(key, savedLayout(state)), options.persistDelayMs ?? 200);
    });
  }
  return store;
}

/** The editor's layout store. */
export const layoutStore = createLayoutStore();

export function useLayout<T>(selector: (state: LayoutStore) => T): T {
  return useStore(layoutStore, selector);
}

const liveDrawerStore = createStore<{ width: number | null }>()(() => ({ width: null }));

/** The width a drawer's edge is being dragged to, before it is committed; null when no drag is under way. */
export function setLiveDrawerWidth(width: number | null): void {
  liveDrawerStore.setState({ width });
}

export function useLiveDrawerWidth(): number | null {
  return useStore(liveDrawerStore, (s) => s.width);
}
