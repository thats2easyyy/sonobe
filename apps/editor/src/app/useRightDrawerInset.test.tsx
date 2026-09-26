// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantStore } from "../panels/assistant/assistantStore.ts";
import { layoutStore, setLiveDrawerWidth } from "../shell/layoutStore.ts";
import { useRightDrawerInset } from "./rightDrawers.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let inset = -1;

function Probe() {
  inset = useRightDrawerInset();
  return null;
}

beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => {
    assistantStore.getState().hide();
    layoutStore.getState().setDrawer(null);
    setLiveDrawerWidth(null);
    root.unmount();
  });
});

describe("useRightDrawerInset", () => {
  it("is 0 with no drawer open", () => {
    expect(inset).toBe(0);
  });

  it("is the drawer's width while the Assistant is open", () => {
    act(() => assistantStore.getState().show());
    expect(inset).toBe(layoutStore.getState().sizes.drawer);
  });

  it("is the drawer's width while Learn is open, following a drag of its edge", () => {
    act(() => layoutStore.getState().setDrawer("learn"));
    expect(inset).toBe(layoutStore.getState().sizes.drawer);
    act(() => setLiveDrawerWidth(420));
    expect(inset).toBe(420);
  });
});
