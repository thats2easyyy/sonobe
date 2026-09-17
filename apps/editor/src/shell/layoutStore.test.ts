// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT, SIZE_LIMITS, createLayoutStore, sanitizeLayout } from "./layoutStore.ts";

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
    expect(layout.drawer).toBe("assistant");
    expect(layout.hudTab).toBe("ai");
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
    s.toggleDrawer("assistant");
    expect(store.getState().drawer).toBe("assistant");
    s.toggleDrawer("assistant");
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

  it("survives corrupt storage", () => {
    localStorage.setItem("test.layout", "{not json");
    expect(createLayoutStore({ storageKey: "test.layout" }).getState().sizes).toEqual(DEFAULT_LAYOUT.sizes);
  });
});
