import { describe, expect, it } from "vitest";
import { createUiStore, type ArmedPort, type HoverPort } from "./uiStore.ts";

const armed: ArmedPort = { nodeId: "a", handleId: "out:value", address: "a.value", type: "number", label: "Value" };
const rect = { x: 0, y: 0, width: 80, height: 20 };
const card = (side: "in" | "out", keyboard?: true): HoverPort => ({ nodeId: "b", address: "b.number", side, rect, ...(keyboard ? { keyboard } : {}) });

describe("ui store", () => {
  it("drops the keyboard card on an input once the arm ends by connecting or cancelling", () => {
    const ui = createUiStore();
    ui.getState().set({ armed, hoverPort: card("in", true) });
    ui.getState().set({ armed: null });
    expect(ui.getState().hoverPort).toBeNull();
  });

  it("keeps the card while the output stays armed for the next input", () => {
    const ui = createUiStore();
    ui.getState().set({ armed, hoverPort: card("in", true) });
    ui.getState().set({ hoverPort: card("in", true) });
    expect(ui.getState().hoverPort).not.toBeNull();
  });

  it("leaves pointer cards and output cards alone", () => {
    const ui = createUiStore();
    ui.getState().set({ armed, hoverPort: card("in") });
    ui.getState().set({ armed: null });
    expect(ui.getState().hoverPort).not.toBeNull();
    ui.getState().set({ armed, hoverPort: card("out", true) });
    ui.getState().set({ armed: null });
    expect(ui.getState().hoverPort).not.toBeNull();
  });

  it("does not close a card when nothing was armed", () => {
    const ui = createUiStore();
    ui.getState().set({ hoverPort: card("in", true) });
    ui.getState().set({ armed: null });
    expect(ui.getState().hoverPort).not.toBeNull();
  });
});
