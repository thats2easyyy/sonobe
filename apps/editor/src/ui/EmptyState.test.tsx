// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState.tsx";

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

describe("EmptyState", () => {
  it("is a tile by default", () => {
    act(() => root.render(<EmptyState icon={<i />} title="No layers" />));
    const empty = container.querySelector(".sb-empty")!;
    expect(empty.getAttribute("data-variant")).toBe("tile");
    expect(empty.firstElementChild?.classList.contains("sb-empty__icon")).toBe(true);
  });

  it("puts the icon on the title line when inline", () => {
    act(() => root.render(<EmptyState variant="inline" icon={<i />} title="Nothing selected" description="Select a layer." actions={<button>Go</button>} />));
    const title = container.querySelector(".sb-empty__title")!;
    expect(title.querySelector(".sb-empty__icon")).not.toBeNull();
    expect(title.textContent).toBe("Nothing selected");
    expect(container.querySelector(".sb-empty__description")?.textContent).toBe("Select a layer.");
    expect(container.querySelector(".sb-empty__actions button")).not.toBeNull();
  });
});
