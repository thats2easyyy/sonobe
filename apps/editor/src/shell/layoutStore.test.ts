// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT, SIZE_LIMITS, createLayoutStore, fitPanelWidths, sanitizeLayout } from "./layoutStore.ts";

describe("sanitizeLayout", () => {
  it("falls back to defaults for garbage", () => {
    expect(sanitizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(sanitizeLayout("nope")).toEqual(DEFAULT_LAYOUT);
  });

  it("clamps sizes and rejects invalid enums", () => {
    const layout = sanitizeLayout({
      sizes: { layers: 9999, viewer: "wide", hud: 10 },
      split: 2,
      collapsed: { inspector: true, hud: "yes" },
      viewMode: "fullscreen",
      splitDirection: "columns",
      drawer: "assistant",
      hudTab: "ai",
    });
    expect(layout.sizes.layers).toBe(SIZE_LIMITS.layers[1]);
    expect(layout.sizes.viewer).toBe(DEFAULT_LAYOUT.sizes.viewer);
    expect(layout.sizes.hud).toBe(SIZE_LIMITS.hud[0]);
    expect(layout.split).toBe(0.85);
    expect(layout.collapsed).toEqual({ ...DEFAULT_LAYOUT.collapsed, inspector: true });
    expect(layout.viewMode).toBe("split");
    expect(layout.splitDirection).toBe("columns");
    expect(layout.drawer).toBeNull();
    expect(layout.hudTab).toBe("ai");
  });

  it("starts the console at 200 for new layouts and leaves a saved height alone", () => {
    expect(DEFAULT_LAYOUT.sizes.hud).toBe(200);
    expect(sanitizeLayout({ sizes: { hud: 164 } }).sizes.hud).toBe(164);
    expect(sanitizeLayout({}).sizes.hud).toBe(200);
  });

  it("keeps the Learn drawer", () => {
    expect(sanitizeLayout({ drawer: "learn" }).drawer).toBe("learn");
  });

  it("keeps the Inspector's Knobs tab, and reads anything else as Properties", () => {
    expect(sanitizeLayout({ inspectorTab: "knobs" }).inspectorTab).toBe("knobs");
    expect(sanitizeLayout({ inspectorTab: "dials" }).inspectorTab).toBe("properties");
  });
});

describe("createLayoutStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("updates panels, drawers, and view mode", () => {
    const store = createLayoutStore({ storageKey: null });
    const s = store.getState();
    s.setSize("inspector", 100);
    expect(store.getState().sizes.inspector).toBe(SIZE_LIMITS.inspector[0]);
    s.toggleCollapsed("layers");
    expect(store.getState().collapsed.layers).toBe(true);
    s.toggleDrawer("learn");
    expect(store.getState().drawer).toBe("learn");
    s.toggleDrawer("learn");
    expect(store.getState().drawer).toBeNull();
    s.toggleCollapsed("hud", true);
    s.setHudTab("diagnostics");
    expect(store.getState().collapsed.hud).toBe(false);
    s.toggleSplitDirection();
    expect(store.getState().splitDirection).toBe("columns");
    s.reset();
    expect(store.getState().sizes).toEqual(DEFAULT_LAYOUT.sizes);
  });

  it("persists after a debounce and restores in a new store", () => {
    const first = createLayoutStore({ storageKey: "test.layout", persistDelayMs: 100 });
    first.getState().setSize("layers", 300);
    first.getState().setViewMode("patches");
    expect(localStorage.getItem("test.layout")).toBeNull();
    vi.advanceTimersByTime(120);
    const saved = JSON.parse(localStorage.getItem("test.layout")!);
    expect(saved.sizes.layers).toBe(300);
    expect(saved).not.toHaveProperty("setSize");

    const second = createLayoutStore({ storageKey: "test.layout" });
    expect(second.getState().sizes.layers).toBe(300);
    expect(second.getState().viewMode).toBe("patches");
  });

  it("saves a temporary layout as what it replaced, and ends it by putting back what still shows", () => {
    const store = createLayoutStore({ storageKey: "test.layout", persistDelayMs: 100 });
    const saved = () => JSON.parse(localStorage.getItem("test.layout")!);
    store.getState().setViewMode("patches");
    store.getState().showTemporary({ viewMode: "split", split: 0.8 });
    expect(store.getState()).toMatchObject({ viewMode: "split", split: 0.8 });
    vi.advanceTimersByTime(120);
    expect(saved()).toMatchObject({ viewMode: "patches", split: DEFAULT_LAYOUT.split });

    // The person moves the split meanwhile: that's theirs.
    store.getState().setSplit(0.6);
    vi.advanceTimersByTime(120);
    expect(saved()).toMatchObject({ viewMode: "patches", split: 0.6 });
    store.getState().endTemporary(true);
    expect(store.getState()).toMatchObject({ viewMode: "patches", split: 0.6, temporary: null });

    // Ended without restoring, it's kept and saved as the person's own.
    store.getState().showTemporary({ split: 0.8 });
    store.getState().endTemporary(false);
    vi.advanceTimersByTime(120);
    expect(saved()).toMatchObject({ viewMode: "patches", split: 0.8 });
  });

  it("survives corrupt storage", () => {
    localStorage.setItem("test.layout", "{not json");
    expect(createLayoutStore({ storageKey: "test.layout" }).getState().sizes).toEqual(DEFAULT_LAYOUT.sizes);
  });
});

describe("fitPanelWidths", () => {
  const open = { layers: false, viewer: false, inspector: false };
  const fit = (available: number, overrides: { sizes?: Partial<typeof DEFAULT_LAYOUT.sizes>; collapsed?: Partial<typeof open>; keepViewer?: boolean } = {}) =>
    fitPanelWidths({ ...DEFAULT_LAYOUT.sizes, ...overrides.sizes }, { ...open, ...overrides.collapsed }, available, undefined, overrides.keepViewer);

  it("leaves the saved sizes alone when the window has room", () => {
    expect(fit(1440)).toEqual({ sizes: { layers: 232, viewer: 296, inspector: 272 }, viewerAuto: false, center: 637 });
  });

  it("shrinks the Viewer first, toward its minimum", () => {
    expect(fit(1180)).toEqual({ sizes: { layers: 232, viewer: 273, inspector: 272 }, viewerAuto: false, center: 400 });
  });

  it("shrinks Layers and then the Inspector once the Viewer is at its minimum", () => {
    expect(fit(1120).sizes).toEqual({ layers: 205, viewer: 240, inspector: 272 });
    expect(fit(1085, { sizes: { layers: 200, viewer: 240, inspector: 300 } }).sizes).toEqual({ layers: 180, viewer: 240, inspector: 262 });
  });

  it("turns the Viewer into a rail when the centre would still be under 400 at 1024", () => {
    expect(fit(1024)).toEqual({ sizes: { layers: 232, viewer: 296, inspector: 272 }, viewerAuto: true, center: 482 });
  });

  it("keeps the Viewer open at its smallest for a person who asked for it, and lets the centre give", () => {
    const fitted = fit(1024, { keepViewer: true });
    expect(fitted).toEqual({ sizes: { layers: 180, viewer: 240, inspector: 240 }, viewerAuto: false, center: 361 });
  });

  it("fits the largest panels a person can set", () => {
    const fitted = fit(1440, { sizes: { layers: 420, viewer: 640, inspector: 440 } });
    expect(fitted).toEqual({ sizes: { layers: 357, viewer: 240, inspector: 440 }, viewerAuto: false, center: 400 });
  });

  it("takes the room of a docked drawer off the row", () => {
    expect(fit(1440 - DEFAULT_LAYOUT.sizes.drawer)).toEqual({ sizes: { layers: 180, viewer: 240, inspector: 257 }, viewerAuto: false, center: 400 });
  });

  it("counts a collapsed panel as a rail and never auto-collapses a Viewer the person collapsed", () => {
    expect(fit(1024, { collapsed: { viewer: true } })).toEqual({ sizes: { layers: 232, viewer: 296, inspector: 272 }, viewerAuto: false, center: 482 });
    expect(fit(700, { collapsed: { layers: true, viewer: true, inspector: true } }).sizes).toEqual({ layers: 232, viewer: 296, inspector: 272 });
  });
});
