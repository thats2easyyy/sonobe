// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette.tsx";
import { CommandProvider } from "./commands/CommandProvider.tsx";
import { CommandRegistry } from "./commands/commandRegistry.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let registry: CommandRegistry;
const copy = vi.fn();
const close = vi.fn();

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  registry = new CommandRegistry();
  registry.register([
    { id: "file.close", title: "Close Prototype", category: "File", run: close },
    { id: "edit.undo", title: "Undo", label: () => "Undo Mute Card Shadow", category: "Edit", run: () => undefined },
    { id: "edit.copy", title: "Copy", category: "Edit", when: () => false, disabledReason: "Select a layer, patch, or comment first", run: copy },
    { id: "patchEditor.alignLeft", title: "Align Left Edges", category: "Patches", shortcut: "Mod+[", when: () => false, disabledReason: "Select 2 or more patches", run: () => undefined },
  ]);
  act(() =>
    root.render(
      <CommandProvider registry={registry} platform="mac" attach={false}>
        <CommandPalette open onOpenChange={() => undefined} />
      </CommandProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const search = (text: string) => {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Commands"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
};

const rows = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((el) => ({ title: el.querySelector(".sb-palette__title")!.textContent, disabled: el.getAttribute("aria-disabled") === "true", reason: el.querySelector(".sb-palette__reason")?.textContent }));

describe("CommandPalette", () => {
  it("browses what you can run now, with live titles", () => {
    expect(rows().map((r) => r.title)).toEqual(["Close Prototype", "Undo Mute Card Shadow"]);
  });

  it("ends with the shared hint line, running on Enter", () => {
    expect([...document.querySelectorAll(".sb-searchlist__hint")].map((el) => el.textContent)).toEqual(["↑↓ navigate", "run", "Esc close"]);
  });

  it("finds unavailable commands greyed out with why, and won't run them", () => {
    const input = search("copy");
    expect(rows()).toEqual([{ title: "Copy", disabled: true, reason: "Select a layer, patch, or comment first" }]);
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(copy).not.toHaveBeenCalled();
    search("align");
    expect(rows()).toEqual([{ title: "Align Left Edges", disabled: true, reason: "Select 2 or more patches" }]);
  });

  it("matches words, not scattered letters, and still finds live titles by their plain name", () => {
    search("undo");
    expect(rows().map((r) => r.title)).toEqual(["Undo Mute Card Shadow"]);
    search("phone");
    expect(rows()).toEqual([]);
    expect(document.body.textContent).toContain("No commands match. To add a patch, hover the patch editor and press ⌥⏎.");
  });

  it("opens on the first command for a category-only match, with the category highlighted", () => {
    search("edit");
    expect(document.querySelector('[role="option"][data-active] .sb-palette__title')?.textContent).toBe("Undo Mute Card Shadow");
    expect(document.querySelector(".sb-palette__category mark")?.textContent).toBe("Edit");
  });

  it("marks keyword-only matches and doesn't run one on Enter until you pick it", () => {
    const comment = vi.fn();
    const group = vi.fn();
    const own = new CommandRegistry();
    own.register([
      { id: "patchEditor.comment", title: "Comment Selected Patches", keywords: ["group", "frame"], category: "Patches", run: comment },
      { id: "patchEditor.group", title: "Group Patches into Component", category: "Patches", when: () => false, disabledReason: "Select 2 or more patches", run: group },
    ]);
    act(() => root.unmount());
    root = createRoot(container);
    act(() =>
      root.render(
        <CommandProvider registry={own} platform="mac" attach={false}>
          <CommandPalette open onOpenChange={() => undefined} />
        </CommandProvider>,
      ),
    );
    const input = search("group");
    expect(rows().map((r) => r.title)).toEqual(["Group Patches into Component", "Comment Selected Patches"]);
    expect(document.querySelector(".sb-palette__matches")?.textContent).toBe("matches “group”");
    expect(document.querySelector('[role="option"][data-active]')).toBeNull();
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(comment).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) act(() => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.querySelector('[role="option"][data-active] .sb-palette__title')?.textContent).toBe("Comment Selected Patches");
  });
});
