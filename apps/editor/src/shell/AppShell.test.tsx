// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { designStore, initialDesignData } from "../panels/design/designStore.ts";
import { DESIGN_CANVAS_SPLIT, followDesignBox } from "../panels/design/layout.ts";
import { ThemeProvider } from "../theme/ThemeProvider.tsx";
import { CommandProvider } from "../ui/commands/CommandProvider.tsx";
import { AppShell } from "./AppShell.tsx";
import { failRender } from "../ui/ErrorBoundary.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Toaster, toast } from "../ui/Toast.tsx";
import { assistantStore } from "../panels/assistant/assistantStore.ts";
import { layoutStore, savedLayout, setLiveDrawerWidth } from "./layoutStore.ts";
import { Panel } from "./Panel.tsx";

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

function renderShell(props: Parameters<typeof AppShell>[0] = {}) {
  act(() =>
    root.render(
      <ThemeProvider>
        <CommandProvider>
          <AppShell {...props} />
        </CommandProvider>
      </ThemeProvider>,
    ),
  );
}

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

describe("AppShell focus", () => {
  const hideLayers = () => container.querySelector<HTMLButtonElement>('[aria-label="Hide layers"]')!;
  const showLayers = () => container.querySelector<HTMLButtonElement>('[aria-label="Show Layers"]')!;

  const layersSlot = (
    <Panel id="layers" title="Layers" actions={<IconButton size="sm" icon={null} label="Hide layers" onClick={() => layoutStore.getState().toggleCollapsed("layers", true)} />}>
      <input aria-label="Filter layers" />
    </Panel>
  );

  it("moves focus to the rail when a panel collapses, and back to the panel's Hide button when the rail reopens it", () => {
    renderShell({ slots: { layers: layersSlot } });
    act(() => hideLayers().focus());
    act(() => hideLayers().click());
    expect(container.querySelector("#sb-layers")).toBeNull();
    expect(document.activeElement).toBe(showLayers());

    act(() => showLayers().click());
    expect(document.activeElement).toBe(hideLayers());
  });

  it("does the same for a shortcut pressed while focus is inside the panel, and leaves focus alone when it is elsewhere", () => {
    renderShell({ slots: { layers: layersSlot } });
    act(() => container.querySelector<HTMLInputElement>('[aria-label="Filter layers"]')!.focus());
    act(() => layoutStore.getState().toggleCollapsed("layers"));
    expect(document.activeElement).toBe(showLayers());
    act(() => layoutStore.getState().toggleCollapsed("layers"));
    expect(document.activeElement).toBe(hideLayers());

    act(() => container.querySelector<HTMLButtonElement>(".sb-toolbar__search")!.focus());
    const toolbarButton = document.activeElement;
    act(() => layoutStore.getState().toggleCollapsed("layers"));
    expect(document.activeElement).toBe(toolbarButton);
  });

  it("gives focus back to the Learn button when the drawer it opened from the keyboard closes", () => {
    renderShell({ slots: { learn: <button type="button">Close lesson</button> } });
    const opener = container.querySelector<HTMLButtonElement>('button[aria-label="Learn"]')!;
    act(() => opener.focus());
    act(() => layoutStore.getState().toggleDrawer("learn"));
    const aside = container.querySelector<HTMLElement>('aside[aria-label="Learn"]')!;
    expect(document.activeElement).toBe(aside);
    act(() => container.querySelector<HTMLButtonElement>("aside button")!.focus());
    act(() => layoutStore.getState().setDrawer(null));
    expect(document.activeElement).toBe(opener);
  });

  it("closes the drawer on Escape, except a docked one, where Escape belongs to the canvas", () => {
    renderShell({ slots: { learn: <p>Lessons</p> } });
    const escape = () => act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    act(() => layoutStore.getState().setDrawer("learn"));
    escape();
    expect(layoutStore.getState().drawer).toBeNull();

    renderShell({ slots: { learn: <p>Lessons</p> }, drawerDocked: true });
    act(() => layoutStore.getState().setDrawer("learn"));
    escape();
    expect(layoutStore.getState().drawer).toBe("learn");
  });

  it("marks the shell while a drawer floats over the panels, so the centre column can end where it starts", () => {
    renderShell({ slots: { learn: <p>Lessons</p> } });
    const main = () => container.querySelector<HTMLElement>(".sb-shell__main")!;
    expect(main().dataset.drawerOver).toBeUndefined();
    act(() => layoutStore.getState().setDrawer("learn"));
    expect(main().dataset.drawerOver).toBe("true");
    expect(main().dataset.drawerDocked).toBeUndefined();
    act(() => layoutStore.getState().setDrawer(null));
    expect(main().dataset.drawerOver).toBeUndefined();

    renderShell({ slots: { learn: <p>Lessons</p> }, drawerDocked: true });
    act(() => layoutStore.getState().setDrawer("learn"));
    expect(main().dataset.drawerOver).toBeUndefined();
    expect(main().dataset.drawerDocked).toBe("true");
  });
});

describe("AppShell with the Assistant sheet", () => {
  it("marks the shell while the Assistant floats over the panels", () => {
    renderShell();
    const main = () => container.querySelector<HTMLElement>(".sb-shell__main")!;
    expect(main().dataset.drawerOver).toBeUndefined();
    act(() => assistantStore.getState().show());
    expect(main().dataset.drawerOver).toBe("true");
    act(() => assistantStore.getState().hide());
    expect(main().dataset.drawerOver).toBeUndefined();
  });
});

describe("AppShell fit", () => {
  const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  // The shell measures its row when it mounts, so the width is set before a fresh mount.
  const rowWidth = (width: number) => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return (this as HTMLElement).classList?.contains("sb-shell__row") ? width : 0; } });
    act(() => root.unmount());
    root = createRoot(container);
  };
  afterEach(() => {
    if (clientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidth);
    else delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
  });

  const slots = { viewer: <p>Viewer body</p>, layers: <p>Layers body</p>, inspector: <p>Inspector body</p> };
  const shell = () => container.querySelector<HTMLElement>(".sb-shell")!;

  it("writes fitted widths and shows the Viewer as a rail without saving it as collapsed, when 1024px is too narrow", () => {
    rowWidth(1024);
    renderShell({ slots });
    expect(container.querySelector('.sb-rail[data-panel="viewer"]')).not.toBeNull();
    expect(container.querySelector("#sb-viewer")).toBeNull();
    expect(layoutStore.getState().collapsed.viewer).toBe(false);
    expect(shell().style.getPropertyValue("--sb-inspector-w")).toBe("272px");
    expect(shell().style.getPropertyValue("--sb-center-min")).toBe("400px");
  });

  it("opens the Viewer from its rail at its smallest, with the other panels giving way", () => {
    rowWidth(1024);
    renderShell({ slots });
    act(() => container.querySelector<HTMLButtonElement>('.sb-rail[data-panel="viewer"] button')!.click());
    expect(container.querySelector("#sb-viewer")).not.toBeNull();
    expect(shell().style.getPropertyValue("--sb-viewer-w")).toBe("240px");
    expect(shell().style.getPropertyValue("--sb-layers-w")).toBe("180px");
    expect(shell().style.getPropertyValue("--sb-center-min")).toBe("361px");
  });

  it("keeps a Viewer opened at 1024px open while other panels are hidden and shown again", () => {
    rowWidth(1024);
    renderShell({ slots });
    act(() => container.querySelector<HTMLButtonElement>('.sb-rail[data-panel="viewer"] button')!.click());
    act(() => layoutStore.getState().toggleCollapsed("layers", true));
    act(() => layoutStore.getState().toggleCollapsed("inspector", true));
    expect(container.querySelector("#sb-viewer")).not.toBeNull();
    act(() => layoutStore.getState().toggleCollapsed("inspector", false));
    act(() => layoutStore.getState().toggleCollapsed("layers", false));
    expect(container.querySelector("#sb-viewer")).not.toBeNull();
    expect(container.querySelector('.sb-rail[data-panel="viewer"]')).toBeNull();
  });

  it("re-fits the panels while a floating drawer's edge is dragged, and lets go when it ends", () => {
    rowWidth(1180);
    renderShell({ slots: { ...slots, learn: <p>Lessons</p> } });
    act(() => layoutStore.getState().setDrawer("learn"));
    const viewerRail = () => container.querySelector('.sb-rail[data-panel="viewer"]') !== null;
    expect(viewerRail()).toBe(false);
    act(() => setLiveDrawerWidth(480));
    expect(shell().style.getPropertyValue("--sb-drawer-w")).toBe("480px");
    expect(viewerRail()).toBe(true);
    act(() => setLiveDrawerWidth(null));
    expect(shell().style.getPropertyValue("--sb-drawer-w")).toBe(`${layoutStore.getState().sizes.drawer}px`);
    expect(viewerRail()).toBe(false);
  });

  it("shrinks panels toward their minimums at 1180px and keeps the saved sizes", () => {
    rowWidth(1180);
    renderShell({ slots });
    expect(container.querySelector('.sb-rail[data-panel="viewer"]')).toBeNull();
    expect(shell().style.getPropertyValue("--sb-viewer-w")).toBe("273px");
    expect(layoutStore.getState().sizes.viewer).toBe(296);
  });
});

describe("AppShell containment", () => {
  const PANELS = [
    ["layers", "Layers", "#sb-layers"],
    ["viewer", "The Viewer", "#sb-viewer"],
    ["canvas", "The canvas", ".sb-shell__canvas"],
    ["patchEditor", "The Patches panel", ".sb-shell__patches"],
    ["inspector", "The Inspector", "#sb-inspector"],
    ["hud", "The bottom panel", "#sb-hud"],
  ] as const;
  const slots = Object.fromEntries(PANELS.map(([slot]) => [slot, <p className={`body-${slot}`}>{slot}</p>]));
  const bodies = () => PANELS.map(([slot]) => container.querySelector(`.body-${slot}`));
  const problem = (scope: ParentNode = container) => scope.querySelector(".sb-surface-problem .sb-empty__title")?.textContent ?? null;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    act(() => layoutStore.getState().toggleCollapsed("hud", false));
  });
  afterEach(() => {
    for (const name of [...PANELS.map(([, name]) => name), "The notice bar", "The command palette", "The Claude button"]) failRender(name, false);
    act(() => toast.clear());
    vi.restoreAllMocks();
  });

  it.each(PANELS)("says a problem in the %s slot when it throws, and leaves the toolbar and every other slot alone", (slot, name, where) => {
    renderShell({ slots });
    const before = bodies();
    const toolbar = container.querySelector(".sb-toolbar");

    act(() => failRender(name));
    const place = container.querySelector(where)!;
    expect(problem(place)).toBe(`${name} hit a problem`);
    expect([...container.querySelectorAll(".sb-surface-problem")]).toHaveLength(1);
    // A side or center panel that failed still looks like its panel: the same title over the problem.
    if (slot !== "hud") expect(place.querySelector(".sb-panel__title")?.textContent).toBe({ layers: "Layers", viewer: "Viewer", canvas: "Canvas", patchEditor: "Patches", inspector: "Inspector" }[slot]);
    expect(container.querySelector(".sb-toolbar")).toBe(toolbar);
    bodies().forEach((body, i) => expect(body, PANELS[i]![0]).toBe(PANELS[i]![0] === slot ? null : before[i]));

    failRender(name, false);
    act(() => place.querySelector<HTMLButtonElement>(".sb-surface-problem button")!.click());
    expect(problem()).toBeNull();
    expect(container.querySelector(`.body-${slot}`)?.textContent).toBe(slot);
  });

  it("drops a notice that can't be drawn, tells the root which part failed, and keeps the panels", () => {
    const onCaughtError = vi.fn();
    act(() => root.unmount());
    root = createRoot(container, { onCaughtError });
    renderShell({ slots: { ...slots, banner: <p className="notice">Changed on disk</p> } });
    expect(container.querySelector(".sb-shell__banners .notice")).not.toBeNull();

    act(() => failRender("The notice bar"));
    expect(container.querySelector(".sb-shell__banners")!.childElementCount).toBe(0);
    expect(problem()).toBeNull();
    expect(bodies().every((body) => body !== null)).toBe(true);
    // No sign on screen, so the report is what says it: the root's handler hears it with the boundary's name (errorReports.ts logs it).
    expect(onCaughtError).toHaveBeenCalledTimes(1);
    expect((onCaughtError.mock.calls[0]![1] as { errorBoundary: { props: { name: string } } }).errorBoundary.props.name).toBe("The notice bar");
  });

  it("closes a command palette that can't be drawn, with a toast, and opens it again once it can", () => {
    renderShell({ slots });
    act(() => root.render(<ThemeProvider><CommandProvider><AppShell slots={slots} /><Toaster /></CommandProvider></ThemeProvider>));
    const open = () => act(() => container.querySelector<HTMLButtonElement>(".sb-toolbar__search")!.click());
    act(() => failRender("The command palette"));
    expect([...document.querySelectorAll(".sb-toast__title")].map((el) => el.textContent)).toEqual(["The command palette hit a problem"]);
    expect(bodies().every((body) => body !== null)).toBe(true);

    failRender("The command palette", false);
    open();
    expect(document.querySelector('[role="dialog"] input, .sb-palette input')).not.toBeNull();
  });

  it("leaves the toolbar when its Claude button can't be drawn", () => {
    renderShell({ slots: { ...slots, claude: <button className="claude">Connect Claude</button> } });
    expect(container.querySelector(".sb-toolbar .claude")).not.toBeNull();
    act(() => failRender("The Claude button"));
    expect(container.querySelector(".sb-toolbar .claude")).toBeNull();
    expect(container.querySelector(".sb-toolbar__search")).not.toBeNull();
    expect(bodies().every((body) => body !== null)).toBe(true);
  });
});
