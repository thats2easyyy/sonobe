// @vitest-environment happy-dom
import { ReactFlowProvider } from "@xyflow/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectPlatform, formatShortcutLabel } from "../../../ui/commands/shortcutManager.ts";
import { PatchEditorContext, type PatchEditorContextValue } from "../state/context.ts";
import { createUiStore } from "../state/uiStore.ts";
import { EmptyGraph, Toolbar } from "./Chrome.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("EmptyGraph", () => {
  it("is one short inline block with a single Insert patch button", () => {
    const openPicker = vi.fn();
    const ctx = { actions: { openPicker } } as unknown as PatchEditorContextValue;
    act(() =>
      root.render(
        <PatchEditorContext.Provider value={ctx}>
          <EmptyGraph />
        </PatchEditorContext.Provider>,
      ),
    );
    const empty = container.querySelector(".sb-empty")!;
    expect(empty.getAttribute("data-variant")).toBe("inline");
    expect(empty.querySelector(".sb-empty__title")!.textContent).toBe("No patches yet");
    const copy = empty.querySelector(".sb-empty__description")!.textContent!;
    expect(copy).toMatch(/Double-click/);
    expect(copy).toContain(formatShortcutLabel("Alt+Enter", detectPlatform()));
    expect(copy.split(/\s+/).length).toBeLessThanOrEqual(14);
    expect(container.querySelectorAll("kbd")).toHaveLength(0);
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe("Insert patch");
    act(() => buttons[0]!.click());
    expect(openPicker).toHaveBeenCalledOnce();
  });
});

describe("Toolbar zoom", () => {
  function mount(roomy: boolean, labelled = true) {
    const ui = createUiStore();
    const ctx = { actions: {}, ui, markViewportManual: vi.fn() } as unknown as PatchEditorContextValue;
    act(() =>
      root.render(
        <PatchEditorContext.Provider value={ctx}>
          <ReactFlowProvider>
            <Toolbar roomy={roomy} labelled={labelled} />
          </ReactFlowProvider>
        </PatchEditorContext.Provider>,
      ),
    );
    return ui;
  }
  const chip = () => container.querySelector<HTMLButtonElement>('button[aria-label^="Patches zoom"]')!;
  const items = () => [...document.querySelectorAll('[role^="menuitem"]')].map((el) => el.textContent);

  it("keeps a fit button and a zoom menu in the toolbar, and only the menu in a small pane", () => {
    mount(true);
    expect(container.querySelector('button[aria-label="Zoom to fit"]')).not.toBeNull();
    expect(chip().getAttribute("aria-label")).toBe("Patches zoom: 100%");
    act(() => root.render(null));
    mount(false);
    expect(container.querySelector('button[aria-label="Zoom to fit"]')).toBeNull();
    expect(chip()).not.toBeNull();
  });

  it("keeps the Patch label and the menu chevron in a small pane, and drops the label only when labelled is false", () => {
    mount(false);
    expect(container.querySelector('button[aria-label="Insert patch"]')!.textContent).toBe("Patch");
    expect(chip().querySelector("svg")).not.toBeNull();
    act(() => root.render(null));
    mount(false, false);
    expect(container.querySelector('button[aria-label="Insert patch"]')!.textContent).toBe("");
  });

  it("lists the zoom steps and the minimap in the menu", () => {
    const ui = mount(true);
    act(() => chip().click());
    expect(items()).toEqual(["Zoom In", "Zoom Out", "Zoom to 100%", "Zoom to Fit", "Show Minimap"].map((label) => expect.stringMatching(new RegExp(`^${label}`))));
    const minimap = document.querySelector<HTMLElement>('[role="menuitemcheckbox"]')!;
    expect(minimap.getAttribute("aria-checked")).toBe("false");
    act(() => minimap.click());
    expect(ui.getState().minimap).toBe(true);
  });
});
