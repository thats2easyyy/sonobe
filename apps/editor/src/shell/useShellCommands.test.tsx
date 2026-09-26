// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider } from "../theme/ThemeProvider.tsx";
import { CommandProvider } from "../ui/commands/CommandProvider.tsx";
import { CommandRegistry, commandDisabledReason } from "../ui/commands/commandRegistry.ts";
import { layoutStore } from "./layoutStore.ts";
import { useShellCommands } from "./useShellCommands.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Shell() {
  useShellCommands({ openPalette: () => undefined, toggleViewer: () => undefined });
  return null;
}

let root: Root;
let registry: CommandRegistry;

beforeEach(() => {
  layoutStore.getState().reset();
  registry = new CommandRegistry();
  root = createRoot(document.createElement("div"));
  act(() =>
    root.render(
      <ThemeProvider>
        <CommandProvider registry={registry} platform="mac" attach={false}>
          <Shell />
        </CommandProvider>
      </ThemeProvider>,
    ),
  );
});

afterEach(() => act(() => root.unmount()));

describe("view mode commands", () => {
  it("answers to the toolbar's name for the split mode", () => {
    expect(registry.get("view.split")?.aliases).toContain("Split");
  });

  it("says what Swap Split Direction needs", () => {
    layoutStore.getState().setViewMode("canvas");
    const swap = registry.get("view.toggleSplitDirection")!;
    expect(registry.isEnabled(swap.id)).toBe(false);
    expect(commandDisabledReason(swap)).toBe("Switch to Canvas and Patches first");
    layoutStore.getState().setViewMode("split");
    expect(registry.isEnabled(swap.id)).toBe(true);
  });
});
