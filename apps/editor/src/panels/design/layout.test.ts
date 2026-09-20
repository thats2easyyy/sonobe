import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLayoutStore } from "../../shell/layoutStore.ts";
import { designStore, initialDesignData } from "./designStore.ts";
import { DESIGN_CANVAS_SPLIT, followDesignBox } from "./layout.ts";

let layout: ReturnType<typeof createLayoutStore>;
let stop: () => void;

beforeEach(() => {
  designStore.setState(initialDesignData());
  layout = createLayoutStore({ storageKey: null });
  stop = followDesignBox(layout);
});

afterEach(() => stop());

const open = () => designStore.getState().openBox();
const close = () => designStore.getState().closeBox();

describe("followDesignBox", () => {
  it("gives the canvas the larger share of a split while the box is open, then puts the split back", () => {
    layout.getState().setSplit(0.42);
    open();
    expect(layout.getState().split).toBe(DESIGN_CANVAS_SPLIT);
    close();
    expect(layout.getState().split).toBe(0.42);
  });

  it("leaves a split alone that already gives the canvas room, or that the person moved while the box was open", () => {
    layout.getState().setSplit(0.7);
    open();
    expect(layout.getState().split).toBe(0.7);
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
});
