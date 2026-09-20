// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { designStore, initialDesignData } from "../panels/design/designStore.ts";
import { DESIGN_CANVAS_SPLIT, followDesignBox } from "../panels/design/layout.ts";
import { ThemeProvider } from "../theme/ThemeProvider.tsx";
import { CommandProvider } from "../ui/commands/CommandProvider.tsx";
import { AppShell } from "./AppShell.tsx";
import { layoutStore, savedLayout } from "./layoutStore.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no layout: the center is 324 px tall, where 0.8 of it (259.2 px) divided by 324 comes back as 0.7999999999999999.
const CENTER_HEIGHT = 324;
const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
const setPointerCapture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "setPointerCapture");

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return (this as HTMLElement).classList?.contains("sb-shell__center") ? CENTER_HEIGHT : 0; } });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, writable: true, value: () => undefined });
});
afterAll(() => {
  if (clientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight);
  if (setPointerCapture) Object.defineProperty(HTMLElement.prototype, "setPointerCapture", setPointerCapture);
  else delete (HTMLElement.prototype as { setPointerCapture?: unknown }).setPointerCapture;
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  layoutStore.getState().reset();
  designStore.setState(initialDesignData());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <ThemeProvider>
        <CommandProvider>
          <AppShell />
        </CommandProvider>
      </ThemeProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  layoutStore.getState().reset();
  localStorage.clear();
});

/** A pointer event on the canvas / patch editor splitter. */
function pointer(type: "pointerdown" | "pointermove" | "pointerup", clientX: number, clientY: number) {
  const splitter = container.querySelector('[aria-label="Resize canvas and patch editor"]')!;
  act(() => {
    splitter.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX, clientY }));
  });
}

describe("AppShell", () => {
  it("keeps the Design with Claude box's room temporary through a click on the canvas splitter, or a press that doesn't move it", () => {
    const stop = followDesignBox(layoutStore);
    act(() => designStore.getState().openBox());
    expect(layoutStore.getState().split).toBe(DESIGN_CANVAS_SPLIT);
    // A click; a press that moves only across the splitter; and a drag that comes back to where it started.
    pointer("pointerdown", 300, 200);
    pointer("pointerup", 300, 200);
    pointer("pointerdown", 300, 200);
    pointer("pointermove", 320, 200);
    pointer("pointerup", 320, 200);
    pointer("pointerdown", 300, 200);
    pointer("pointermove", 300, 230);
    pointer("pointermove", 300, 200);
    pointer("pointerup", 300, 200);
    expect(layoutStore.getState().split).toBe(DESIGN_CANVAS_SPLIT);
    expect(savedLayout(layoutStore.getState()).split).toBe(0.42);
    act(() => designStore.getState().closeBox());
    expect(layoutStore.getState().split).toBe(0.42);

    // A real drag while the box is open is the person's split, and it stays.
    act(() => designStore.getState().openBox());
    pointer("pointerdown", 300, 200);
    pointer("pointermove", 300, 190);
    pointer("pointerup", 300, 190);
    expect(layoutStore.getState().split).toBe(249 / CENTER_HEIGHT);
    act(() => designStore.getState().closeBox());
    expect(layoutStore.getState().split).toBe(249 / CENTER_HEIGHT);
    stop();
  });
});
