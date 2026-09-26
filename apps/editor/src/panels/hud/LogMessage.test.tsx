// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogMessage } from "./LogMessage.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function measure(scrollHeight: number, clientHeight: number) {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(scrollHeight);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(clientHeight);
}

describe("LogMessage", () => {
  it("offers Show all only when the text runs past its three lines", () => {
    measure(48, 48);
    act(() => root.render(<LogMessage text="short" expanded={false} onToggle={() => undefined} />));
    expect(container.querySelector("button")).toBeNull();

    measure(49, 48);
    act(() => root.render(<LogMessage text="short but wrapped" expanded={false} onToggle={() => undefined} />));
    expect(container.querySelector("button")).toBeNull();

    measure(120, 48);
    act(() => root.render(<LogMessage text="long" expanded={false} onToggle={() => undefined} />));
    expect(container.querySelector("button")?.textContent).toBe("Show all");
  });

  it("keeps the whole text in the DOM and lets it collapse again", () => {
    measure(120, 48);
    const text = "x".repeat(3000);
    const onToggle = vi.fn();
    act(() => root.render(<LogMessage text={text} expanded={false} onToggle={onToggle} />));
    expect(container.querySelector(".sb-logrow__message")?.textContent).toBe(text);
    act(() => container.querySelector("button")!.click());
    expect(onToggle).toHaveBeenCalledOnce();

    act(() => root.render(<LogMessage text={text} expanded onToggle={onToggle} />));
    const button = container.querySelector("button")!;
    expect(button.textContent).toBe("Show less");
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});
