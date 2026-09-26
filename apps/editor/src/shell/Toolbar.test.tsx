// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ASSISTANT_COMMAND_ID } from "../panels/assistant/commands.ts";
import { assistantStore, initialAssistantData } from "../panels/assistant/assistantStore.ts";
import { ThemeProvider } from "../theme/ThemeProvider.tsx";
import { CommandProvider } from "../ui/commands/CommandProvider.tsx";
import { CommandRegistry } from "../ui/commands/commandRegistry.ts";
import { layoutStore } from "./layoutStore.ts";
import { Toolbar, type ToolbarProps } from "./Toolbar.tsx";

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
  layoutStore.getState().reset();
  assistantStore.setState(initialAssistantData());
  delete (window as { sonobeHost?: unknown }).sonobeHost;
});

function mount(overrides: Partial<ToolbarProps> = {}, registry = new CommandRegistry()) {
  const calls = { renamed: [] as string[], toggled: 0, restarted: 0, palette: 0, devices: [] as string[] };
  const props: ToolbarProps = {
    documentTitle: "Photo Zoom",
    onRename: (name) => calls.renamed.push(name),
    deviceId: "iphone-17-pro",
    onDeviceChange: (id) => calls.devices.push(id),
    playing: true,
    onTogglePlay: () => calls.toggled++,
    onRestart: () => calls.restarted++,
    onOpenPalette: () => calls.palette++,
    claude: <button type="button">Connect Claude</button>,
    ...overrides,
  };
  act(() =>
    root.render(
      <ThemeProvider>
        <CommandProvider registry={registry} attach={false}>
          <Toolbar {...props} />
        </CommandProvider>
      </ThemeProvider>,
    ),
  );
  return calls;
}

const byLabel = (label: string) => container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
const titleButton = () => container.querySelector<HTMLButtonElement>(".sb-toolbar__doc")!;
const key = (target: Element, k: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

describe("Toolbar", () => {
  it("binds transport, palette, and the Claude slot", () => {
    const calls = mount();
    expect(titleButton().textContent).toContain("Photo Zoom");
    expect(byLabel("Unsaved changes")).toBeNull();
    act(() => byLabel("Pause prototype")!.click());
    act(() => byLabel("Restart prototype")!.click());
    act(() => container.querySelector<HTMLButtonElement>(".sb-toolbar__search")!.click());
    expect(calls).toMatchObject({ toggled: 1, restarted: 1, palette: 1 });
    expect(container.textContent).toContain("Connect Claude");
  });

  it("shows play while paused and the unsaved marker when dirty", () => {
    mount({ playing: false, dirty: true });
    expect(byLabel("Play prototype")).not.toBeNull();
    expect(byLabel("Unsaved changes")).not.toBeNull();
  });

  it("renames on Enter and keeps the name on Escape", () => {
    const calls = mount();
    act(() => titleButton().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    let input = container.querySelector<HTMLInputElement>('input[aria-label="Prototype name"]')!;
    expect(input.value).toBe("Photo Zoom");
    act(() => {
      input.value = "Checkout Flow";
      key(input, "Enter");
    });
    expect(calls.renamed).toEqual(["Checkout Flow"]);
    expect(container.querySelector('input[aria-label="Prototype name"]')).toBeNull();

    act(() => titleButton().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    input = container.querySelector<HTMLInputElement>('input[aria-label="Prototype name"]')!;
    act(() => {
      input.value = "Nope";
      key(input, "Escape");
    });
    expect(calls.renamed).toEqual(["Checkout Flow"]);
  });

  it("toggles the Learn drawer", () => {
    mount();
    act(() => byLabel("Learn")!.click());
    expect(layoutStore.getState().drawer).toBe("learn");
    act(() => byLabel("Learn")!.click());
    expect(layoutStore.getState().drawer).toBeNull();
  });

  it("names the view modes and explains the disabled split direction", () => {
    mount();
    expect(container.querySelector('[role="radio"][aria-label="Canvas only"]')!.textContent).toBe("Canvas");
    expect(container.querySelector('[role="radio"][aria-label="Canvas and patches"]')!.textContent).toBe("Split");
    expect(container.querySelector('[role="radio"][aria-label="Patches only"]')!.textContent).toBe("Patches");
    const direction = byLabel("Put patches beside the canvas") as HTMLButtonElement;
    expect(direction.disabled).toBe(false);
    act(() => container.querySelector<HTMLElement>('[role="radio"][aria-label="Canvas only"]')!.click());
    expect((byLabel("Put patches beside the canvas") as HTMLButtonElement).disabled).toBe(true);
    act(() => container.querySelector<HTMLElement>('[role="radio"][aria-label="Canvas and patches"]')!.click());
    act(() => (byLabel("Put patches beside the canvas") as HTMLButtonElement).click());
    expect(layoutStore.getState().splitDirection).toBe("columns");
    expect(byLabel("Put patches below the canvas")).not.toBeNull();
  });

  it("keeps the unsaved dot out of the layout and names it", () => {
    mount({ dirty: true });
    const dot = byLabel("Unsaved changes")!;
    expect(dot.className).toContain("sb-toolbar__dirty");
    expect(titleButton().contains(dot)).toBe(true);
  });

  it("shows the Assistant button on the desktop only", () => {
    mount();
    expect(byLabel("Assistant")).toBeNull();
    delete (window as { sonobeHost?: unknown }).sonobeHost;
    (window as { sonobeHost?: unknown }).sonobeHost = {};
    mount();
    expect(byLabel("Assistant")).not.toBeNull();
  });

  it("toggles the Assistant through its command, and shows when it is open and waiting for an answer", () => {
    (window as { sonobeHost?: unknown }).sonobeHost = {};
    const registry = new CommandRegistry();
    let runs = 0;
    registry.register({ id: ASSISTANT_COMMAND_ID, title: "Assistant", shortcut: "Mod+6", run: () => void runs++ });
    mount({}, registry);
    const button = byLabel("Assistant")!;
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector(".sb-toolbar__pending")).toBeNull();
    act(() => button.click());
    expect(runs).toBe(1);

    act(() => assistantStore.setState({ open: true, items: [{ kind: "confirm", id: "c1", runId: "r1", status: "pending" } as never] }));
    expect(byLabel("Assistant")).toBeNull();
    expect(byLabel("Assistant, waiting for your answer")!.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".sb-toolbar__pending")).not.toBeNull();
  });

  it("adds Undo and Redo to the title menu in the browser, with the undo step named", () => {
    const registry = new CommandRegistry();
    registry.register([
      { id: "edit.undo", title: "Undo", label: () => "Undo Move Title", shortcut: "Mod+Z", run: () => undefined },
      { id: "edit.redo", title: "Redo", when: () => false, run: () => undefined },
    ]);
    mount({}, registry);
    act(() => titleButton().click());
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    expect(items.some((text) => text?.includes("Undo Move Title"))).toBe(true);
    expect(items.some((text) => text?.startsWith("Redo"))).toBe(true);
  });

  it("says why a disabled Redo is disabled", () => {
    const registry = new CommandRegistry();
    registry.register({ id: "edit.redo", title: "Redo", when: () => false, disabledReason: "Nothing to redo", run: () => undefined });
    mount({}, registry);
    act(() => titleButton().click());
    const redo = [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent?.startsWith("Redo"))!;
    expect(redo.getAttribute("aria-disabled")).toBe("true");
    expect(redo.textContent).toContain("Nothing to redo");
  });

  it("leaves Undo and Redo to the native Edit menu on the desktop", () => {
    (window as { sonobeHost?: unknown }).sonobeHost = {};
    const registry = new CommandRegistry();
    registry.register({ id: "edit.undo", title: "Undo", run: () => undefined });
    mount({}, registry);
    act(() => titleButton().click());
    expect([...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent?.startsWith("Undo"))).toBe(false);
  });
});
