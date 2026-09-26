// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toggle } from "./Toggle.tsx";

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

describe("Toggle", () => {
  it("says on or off", () => {
    act(() => root.render(<Toggle aria-label="Clip" checked onChange={() => undefined} />));
    const toggle = container.querySelector("button")!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.hasAttribute("data-checked")).toBe(true);
  });

  it("says mixed, and a click turns everything on", () => {
    const onChange = vi.fn();
    act(() => root.render(<Toggle aria-label="Clip" checked={false} mixed onChange={onChange} />));
    const toggle = container.querySelector("button")!;
    expect(toggle.getAttribute("role")).toBe("checkbox");
    expect(toggle.getAttribute("aria-checked")).toBe("mixed");
    expect(toggle.hasAttribute("data-mixed")).toBe(true);
    expect(toggle.hasAttribute("data-checked")).toBe(false);
    act(() => toggle.click());
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
