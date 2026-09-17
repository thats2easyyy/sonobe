// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider } from "../theme/ThemeProvider.tsx";
import { CommandProvider } from "../ui/commands/CommandProvider.tsx";
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
});

function mount(overrides: Partial<ToolbarProps> = {}) {
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
        <CommandProvider attach={false}>
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
});
