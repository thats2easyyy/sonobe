// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Tooltip } from "./Tooltip.tsx";

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
  document.body.innerHTML = "";
});

const tip = () => document.querySelector<HTMLElement>(".sb-tooltip");

function focusInside(visible: boolean) {
  const button = container.querySelector("button")!;
  const matches = button.matches.bind(button);
  Object.defineProperty(button, "matches", { value: (selector: string) => (selector === ":focus-visible" ? visible : matches(selector)), configurable: true });
  act(() => button.focus());
}

describe("Tooltip", () => {
  it("opens at once when a descendant of the trigger has keyboard focus", () => {
    act(() =>
      root.render(
        <Tooltip content="Rename the layer">
          <div>
            <button type="button">Rename</button>
          </div>
        </Tooltip>,
      ),
    );
    focusInside(true);
    expect(tip()?.textContent).toBe("Rename the layer");
    expect(container.querySelector("div")!.getAttribute("aria-describedby")).toBe(tip()!.id);
  });

  it("stays closed for focus that came from a pointer", () => {
    act(() =>
      root.render(
        <Tooltip content="Rename the layer">
          <button type="button">Rename</button>
        </Tooltip>,
      ),
    );
    focusInside(false);
    expect(tip()).toBeNull();
  });

  it("ignores a click into a text field inside the trigger, but opens for a text field that is the trigger", () => {
    const pretendFocusVisible = (el: HTMLElement) => {
      const matches = el.matches.bind(el);
      Object.defineProperty(el, "matches", { value: (selector: string) => (selector === ":focus-visible" ? true : matches(selector)), configurable: true });
    };
    act(() =>
      root.render(
        <Tooltip content="Full value">
          <div>
            <input type="text" defaultValue="12.5" />
          </div>
        </Tooltip>,
      ),
    );
    const inside = container.querySelector("input")!;
    pretendFocusVisible(inside);
    act(() => inside.focus());
    expect(tip()).toBeNull();
    act(() => inside.blur());
    act(() =>
      root.render(
        <Tooltip content="Full value">
          <input type="text" defaultValue="12.5" />
        </Tooltip>,
      ),
    );
    const own = container.querySelector("input")!;
    pretendFocusVisible(own);
    act(() => own.focus());
    expect(tip()?.textContent).toBe("Full value");
  });

  it("keeps its own width cap instead of the room left in the viewport", () => {
    act(() =>
      root.render(
        <Tooltip content={"A long explanation of why this is unavailable right now. ".repeat(6)}>
          <button type="button">Why</button>
        </Tooltip>,
      ),
    );
    focusInside(true);
    const maxWidth = tip()!.style.maxWidth;
    expect(maxWidth).toMatch(/^min\(var\(--sb-tooltip-max-width\), [\d.]+px\)$/);
  });
});
