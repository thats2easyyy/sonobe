// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLayoutStore } from "../../shell/layoutStore.ts";
import { designStore, initialDesignData, MCP_DRAFT_IDLE_MS, type DesignDraft, type DraftStatus } from "./designStore.ts";
import { DESIGN_CANVAS_SPLIT, followDesignBox } from "./layout.ts";

let layout: ReturnType<typeof createLayoutStore>;
let stop: () => void;

beforeEach(() => {
  designStore.setState(initialDesignData());
  layout = createLayoutStore({ storageKey: null });
  stop = followDesignBox(layout);
});

afterEach(() => {
  stop();
  vi.useRealTimers();
  localStorage.clear();
});

const open = () => designStore.getState().openBox();
const close = () => designStore.getState().closeBox();

/** Claude Code's preview_design draft, as the design.preview RPC leaves it in the store. */
const mcpDraft = (status: DraftStatus, touchedAt = Date.now()): DesignDraft => ({
  source: "mcp",
  key: "mcp:cc-1",
  runId: "",
  turn: 0,
  toolUseId: "",
  html: "<p>Checkout</p>",
  fields: { name: "Checkout" },
  status,
  since: touchedAt,
  progress: null,
  error: null,
  resync: false,
  mcp: { author: { kind: "agent", name: "Claude" }, client: { id: "cc-1", label: "Claude Code" }, revision: 1, touchedAt, addingFrom: status === "writing" ? null : 3 },
});
const draft = (status: DraftStatus) => designStore.setState({ drafts: [mcpDraft(status)] });

describe("followDesignBox", () => {
  it("gives the canvas most of a split while the box is open, then puts the split back", () => {
    expect(DESIGN_CANVAS_SPLIT).toBe(0.8);
    layout.getState().setSplit(0.42);
    open();
    expect(layout.getState().split).toBe(DESIGN_CANVAS_SPLIT);
    close();
    expect(layout.getState().split).toBe(0.42);
  });

  it("leaves a split alone that already gives the canvas room, or that the person moved while the box was open", () => {
    layout.getState().setSplit(0.82);
    open();
    expect(layout.getState().split).toBe(0.82);
    close();

    layout.getState().setSplit(0.3);
    open();
    layout.getState().setSplit(0.5);
    close();
    expect(layout.getState().split).toBe(0.5);
  });

  it("shows the canvas from the patch editor alone, and goes back to it on close", () => {
    layout.getState().setViewMode("patches");
    layout.getState().setSplit(0.42);
    open();
    expect(layout.getState()).toMatchObject({ viewMode: "split", split: DESIGN_CANVAS_SPLIT });
    close();
    expect(layout.getState()).toMatchObject({ viewMode: "patches", split: 0.42 });
  });

  it("changes nothing for the canvas alone or a side-by-side split", () => {
    layout.getState().setViewMode("canvas");
    layout.getState().setSplit(0.42);
    open();
    expect(layout.getState()).toMatchObject({ viewMode: "canvas", split: 0.42 });
    close();

    layout.getState().setViewMode("split");
    layout.getState().toggleSplitDirection();
    open();
    expect(layout.getState()).toMatchObject({ splitDirection: "columns", split: 0.42 });
  });

  it("never saves the room: after a reload with the box open, the person's own layout comes back", () => {
    vi.useFakeTimers();
    stop();
    const saved = createLayoutStore({ storageKey: "test.design-layout", persistDelayMs: 10 });
    saved.getState().setViewMode("patches");
    saved.getState().setSplit(0.3);
    stop = followDesignBox(saved);
    open();
    saved.getState().setSize("layers", 300);
    vi.advanceTimersByTime(20);
    expect(saved.getState()).toMatchObject({ viewMode: "split", split: DESIGN_CANVAS_SPLIT });
    expect(JSON.parse(localStorage.getItem("test.design-layout")!)).toMatchObject({ viewMode: "patches", split: 0.3, sizes: { layers: 300 } });

    // The window reloads, and the box starts closed.
    stop();
    designStore.setState(initialDesignData());
    const reloaded = createLayoutStore({ storageKey: "test.design-layout" });
    stop = followDesignBox(reloaded);
    expect(reloaded.getState()).toMatchObject({ viewMode: "patches", split: 0.3 });
  });

  it("makes room while Claude Code writes a draft with the box closed, and gives it back when the draft ends without an import", () => {
    layout.getState().setViewMode("patches");
    layout.getState().setSplit(0.42);
    draft("writing");
    expect(layout.getState()).toMatchObject({ viewMode: "split", split: DESIGN_CANVAS_SPLIT });
    draft("adding");
    expect(layout.getState().split).toBe(DESIGN_CANVAS_SPLIT);
    draft("stopped");
    expect(layout.getState()).toMatchObject({ viewMode: "patches", split: 0.42 });
  });

  it("keeps the room when Claude Code's draft ends in an import, as the person's own layout", () => {
    vi.useFakeTimers();
    stop();
    const saved = createLayoutStore({ storageKey: "test.design-layout", persistDelayMs: 10 });
    saved.getState().setSplit(0.42);
    stop = followDesignBox(saved);
    draft("writing");
    draft("adding");
    vi.advanceTimersByTime(20);
    expect(JSON.parse(localStorage.getItem("test.design-layout")!).split).toBe(0.42);
    draft("added");
    expect(saved.getState().split).toBe(DESIGN_CANVAS_SPLIT);
    vi.advanceTimersByTime(20);
    expect(JSON.parse(localStorage.getItem("test.design-layout")!).split).toBe(DESIGN_CANVAS_SPLIT);
    // Opening and closing the box later leaves it: it's the person's split now.
    open();
    close();
    expect(saved.getState().split).toBe(DESIGN_CANVAS_SPLIT);
  });

  it("keeps the room while either the box or a draft needs it", () => {
    layout.getState().setSplit(0.42);
    open();
    draft("writing");
    close();
    expect(layout.getState().split).toBe(DESIGN_CANVAS_SPLIT);
    draft("stopped");
    expect(layout.getState().split).toBe(0.42);

    // An import that lands with the box open gives the room back when the box closes.
    draft("writing");
    open();
    draft("added");
    expect(layout.getState().split).toBe(DESIGN_CANVAS_SPLIT);
    close();
    expect(layout.getState().split).toBe(0.42);
  });

  it("gives the room back when a draft goes idle, as it leaves the canvas", () => {
    vi.useFakeTimers();
    layout.getState().setSplit(0.42);
    draft("writing");
    expect(layout.getState().split).toBe(DESIGN_CANVAS_SPLIT);
    vi.advanceTimersByTime(MCP_DRAFT_IDLE_MS - 1000);
    expect(layout.getState().split).toBe(DESIGN_CANVAS_SPLIT);
    vi.advanceTimersByTime(1001);
    expect(layout.getState().split).toBe(0.42);
  });
});
