// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectPlatform, formatShortcutLabel } from "../../../ui/commands/shortcutManager.ts";
import { PatchEditorContext, type PatchEditorContextValue } from "../state/context.ts";
import { EmptyGraph } from "./Chrome.tsx";

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
