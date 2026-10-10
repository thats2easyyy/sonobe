// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler, type ManualScheduler } from "../../runtime/scheduler.ts";
import { EditorProvider } from "../../state/EditorProvider.tsx";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { CommandProvider } from "../../ui/commands/CommandProvider.tsx";
import { CommandRegistry } from "../../ui/commands/commandRegistry.ts";
import { failRender } from "../../ui/ErrorBoundary.tsx";
import { PanelBoundary } from "../../shell/Panel.tsx";
import type { BoundsProvider, PreviewStatus } from "./hostBridge.ts";
import { ViewerPanel } from "./ViewerPanel.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let session: EditorSession;
let scheduler: ManualScheduler;
let registry: CommandRegistry;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  scheduler = createManualScheduler();
  session = createEditorSession({ host: null, scheduler, textMeasurer: "approximate", autoplay: false });
  registry = new CommandRegistry();
});

afterEach(() => {
  act(() => root.unmount());
  session.dispose();
  container.remove();
  document.body.innerHTML = "";
  delete (window as { sonobeHost?: unknown }).sonobeHost;
});

function mount(ui: ReactNode) {
  act(() => {
    root.render(
      <CommandProvider registry={registry} attach={false}>
        <EditorProvider session={session} rpc={false} clipboardEvents={false}>
          {ui}
        </EditorProvider>
      </CommandProvider>,
    );
  });
  act(() => scheduler.frame());
}

const flush = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const buttonWithText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(text));
const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((el) => el.querySelector(".sb-menu__title")?.textContent === label);

function chooseMore(label: string) {
  act(() => button("More viewer options")!.click());
  const item = menuItem(label);
  expect(item, `menu item "${label}"`).toBeDefined();
  act(() => item!.click());
}

const STOPPED: PreviewStatus = { running: false, url: null, urls: [], lanReachable: true, clients: 0, error: null };
const RUNNING: PreviewStatus = { running: true, url: "http://192.168.1.5:5204/p?t=abc", urls: ["http://192.168.1.5:5204/p?t=abc", "http://10.0.0.2:5204/p?t=abc"], lanReachable: true, clients: 1, error: null };

describe("ViewerPanel", () => {
  it("lets go of the prototype's renderer when the panel fails, while the prototype runs on, and takes it back on Try again", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mount(
      <PanelBoundary name="The Viewer" title="Viewer" scope="viewer" surface="sunken">
        <ViewerPanel />
      </PanelBoundary>,
    );
    expect(session.runtime.state.getState().viewers).toBe(1);

    act(() => failRender("The Viewer"));
    expect(container.querySelector(".sb-panel__title")?.textContent).toBe("Viewer");
    expect(container.querySelector(".sb-surface-problem .sb-empty__title")?.textContent).toBe("The Viewer hit a problem");
    expect(container.querySelector(".sonobe-device")).toBeNull();
    expect(session.runtime.state.getState().viewers).toBe(0);
    // The prototype belongs to the session, not the panel: it still steps.
    const frame = session.runtime.runtime.frame;
    session.runtime.stepFrame();
    expect(session.runtime.runtime.frame).toBe(frame + 1);

    failRender("The Viewer", false);
    act(() => container.querySelector<HTMLButtonElement>(".sb-surface-problem button")!.click());
    act(() => scheduler.frame());
    expect(session.runtime.state.getState().viewers).toBe(1);
    expect(container.querySelector(".sonobe-device .sonobe-stage")?.childElementCount).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });


  it("draws the prototype inside a device frame", () => {
    mount(<ViewerPanel />);
    expect(container.querySelector(".sonobe-device[data-frame=on]")).not.toBeNull();
    expect(container.querySelector(".sonobe-device .sonobe-stage")?.childElementCount).toBeGreaterThan(0);
    expect(container.querySelector(".sb-vw__pill")?.textContent).toContain("Paused");
  });

  it("keeps zoom, More and Hide in the header, with Restart and the frame in the menu", () => {
    mount(<ViewerPanel onCollapse={() => undefined} />);
    const header = container.querySelector(".sb-panel__header")!;
    expect(header.querySelector('[aria-label="Device"]')).toBeNull();
    expect(header.querySelector('[aria-label^="Viewer zoom:"]')).not.toBeNull();
    for (const label of ["More viewer options", "Hide viewer"]) {
      expect(header.querySelector(`[aria-label="${label}"]`), label).not.toBeNull();
    }
    for (const label of ["Restart prototype", "Device frame", "Show hit targets"]) {
      expect(header.querySelector(`[aria-label="${label}"]`), label).toBeNull();
    }
    expect(header.querySelector(".sb-vw__device-name")?.textContent).toBeTruthy();
    const restart = vi.spyOn(session.runtime, "restart");
    chooseMore("Restart");
    expect(restart).toHaveBeenCalledOnce();
    act(() => button("More viewer options")!.click());
    expect(menuItem("Restart")?.textContent).toMatch(/^Restart(⌘R|Ctrl\+R)$/);
    expect(menuItem("Show Device Frame")).toBeDefined();
  });

  it("shows a hit targets chip in the header only while hit targets are on", () => {
    mount(<ViewerPanel />);
    expect(button("Show hit targets")).toBeNull();
    chooseMore("Show Hit Targets");
    expect(button("Show hit targets")?.getAttribute("aria-pressed")).toBe("true");
    act(() => button("Show hit targets")!.click());
    expect(button("Show hit targets")).toBeNull();
  });

  it("gives the zoom and More triggers tooltips that step aside while their menu is open", () => {
    vi.useFakeTimers();
    try {
      mount(<ViewerPanel />);
      const hover = (el: HTMLElement) => {
        act(() => void el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })));
        act(() => void el.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" })));
        act(() => void vi.advanceTimersByTime(600));
      };
      const zoom = document.querySelector<HTMLElement>('button[aria-label^="Viewer zoom:"]')!;
      hover(zoom);
      expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Zoom");
      act(() => void zoom.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" })));
      act(() => void zoom.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" })));
      const more = button("More viewer options")!;
      act(() => void more.click());
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
      hover(more);
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("switches between fit and actual size from the zoom menu", () => {
    mount(<ViewerPanel />);
    expect(container.querySelector(".sb-vw__scroll")?.getAttribute("data-zoom")).toBe("fit");
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label^="Viewer zoom:"]')!.click());
    act(() => menuItem("Actual Size")!.click());
    expect(container.querySelector(".sb-vw__scroll")?.getAttribute("data-zoom")).toBe("actual");
    expect(document.querySelector('button[aria-label="Viewer zoom: 100%"]')).not.toBeNull();
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label^="Viewer zoom:"]')!.click());
    act(() => menuItem("Zoom to Fit")!.click());
    expect(container.querySelector(".sb-vw__scroll")?.getAttribute("data-zoom")).toBe("fit");
  });

  it("registers viewer commands; ⌥D toggles the frame", () => {
    mount(<ViewerPanel />);
    expect(registry.get("viewer.toggleDeviceFrame")?.shortcut).toBe("Alt+D");
    act(() => {
      registry.run("viewer.toggleDeviceFrame");
    });
    expect(container.querySelector(".sonobe-device[data-frame=off]")).not.toBeNull();
    expect(registry.isEnabled("viewer.previewOnDevice")).toBe(false);
  });

  it("rotates from the options menu as one undoable change", () => {
    mount(<ViewerPanel />);
    chooseMore("Rotate to Landscape");
    expect(session.document.getState().doc.project.device.orientation).toBe("landscape");
    expect(session.document.getState().undoLabel).toBe("You: Rotate device to landscape");
    act(() => {
      session.document.getState().undo();
    });
    expect(session.document.getState().doc.project.device.orientation).toBeUndefined();
  });

  it("outlines selected layers from the live scene", () => {
    mount(<ViewerPanel />);
    act(() => session.selection.getState().select({ layers: ["card"] }));
    const polygons = [...container.querySelectorAll<SVGPolygonElement>(".sb-vw-highlight polygon")].filter((p) => p.style.display !== "none");
    expect(polygons).toHaveLength(1);
    expect(polygons[0]!.getAttribute("data-kind")).toBe("selected");
    act(() => session.selection.getState().clear());
    expect([...container.querySelectorAll<SVGPolygonElement>(".sb-vw-highlight polygon")].every((p) => p.style.display === "none")).toBe(true);
  });

  it("shows On phone only with a LAN preview URL", () => {
    mount(<ViewerPanel />);
    expect(buttonWithText("On phone")).toBeUndefined();
    mount(<ViewerPanel lanPreviewUrl="http://192.168.0.2:5204/p" />);
    expect(buttonWithText("On phone")).toBeDefined();
    expect(registry.isEnabled("viewer.previewOnDevice")).toBe(true);
  });

  it("starts the desktop host's phone preview and shows its link, phones, and other addresses", async () => {
    let listener: ((status: PreviewStatus) => void) | null = null;
    const host = {
      getPreviewStatus: vi.fn(async () => STOPPED),
      startPreview: vi.fn(async () => RUNNING),
      stopPreview: vi.fn(async () => STOPPED),
      onPreviewStatus: vi.fn((cb: (status: PreviewStatus) => void) => {
        listener = cb;
        return () => {
          listener = null;
        };
      }),
    };
    (window as { sonobeHost?: unknown }).sonobeHost = host;
    mount(<ViewerPanel />);
    await flush();
    expect(registry.isEnabled("viewer.previewOnDevice")).toBe(true);
    act(() => buttonWithText("On phone")!.click());
    expect(document.querySelector(".sb-phone__url")).toBeNull();
    await act(async () => {
      buttonWithText("Start phone preview")!.click();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(host.startPreview).toHaveBeenCalledOnce();
    expect(document.querySelector(".sb-phone__url code")?.textContent).toBe(RUNNING.url);
    expect(document.querySelector(".sb-phone__status")?.textContent).toContain("1 phone connected");
    expect([...document.querySelectorAll(".sb-phone__alt")].map((b) => b.textContent)).toEqual(["10.0.0.2:5204"]);
    const notes = () => [...document.querySelectorAll(".sb-phone__note")].map((p) => p.textContent);
    expect(notes()).toEqual(["On iPhone, scan with the Sonobe Viewer app to feel haptics. A three-finger tap opens its menu."]);
    expect(document.querySelector(".sb-vw__phone")?.hasAttribute("data-connected")).toBe(true);
    act(() => listener?.({ ...RUNNING, clients: 0 }));
    expect(notes()).toHaveLength(2);
    expect(notes()[0]).toContain("same Wi-Fi");
    expect(document.querySelector(".sb-vw__phone .sb-vw__dot")).not.toBeNull();
    expect(document.querySelector(".sb-vw__phone")?.hasAttribute("data-connected")).toBe(false);
    act(() => listener?.({ ...RUNNING, clients: 3 }));
    expect(buttonWithText("On phone")!.textContent).toContain("3");
    await act(async () => {
      buttonWithText("Stop phone preview")!.click();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(host.stopPreview).toHaveBeenCalledOnce();
    expect(buttonWithText("Start phone preview")).toBeDefined();
  });

  it("keeps one plain status word in the docked footer, with no fps text and no second Pause button", () => {
    mount(<ViewerPanel />);
    const status = () => container.querySelector(".sb-vw__pill[data-static]")!;
    expect(status().textContent).toBe("Paused");
    expect(status().getAttribute("role")).toBeNull();
    act(() => session.runtime.state.setState({ playing: true, fps: 60 }));
    expect(status().textContent).toBe("Live");
    act(() => session.runtime.state.setState({ fps: 41.6 }));
    expect(status().textContent).toBe("Live");
    expect(container.querySelector(".sb-vw__pill-meta")).toBeNull();
    expect(button("Pause prototype")).toBeNull();
    expect(button("Play prototype")).toBeNull();
  });

  it("keeps play/pause and the fps text in the floating window, which has no toolbar", () => {
    mount(<ViewerPanel />);
    chooseMore("Pop Out Viewer");
    const float = document.querySelector(".sb-float")!;
    act(() => session.runtime.state.setState({ playing: true, fps: 41.6 }));
    expect(float.querySelector(".sb-vw__pill[data-static]")?.textContent).toBe("Live42 fps");
    const pause = float.querySelector<HTMLButtonElement>('button[aria-label="Pause prototype"]')!;
    expect(pause).not.toBeNull();
    const toggle = vi.spyOn(session.runtime, "togglePlay");
    act(() => pause.click());
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("opens Diagnostics from the footer warning, which hides while the note over the stage names it", () => {
    const showDiagnostics = vi.fn();
    registry.register({ id: "view.showDiagnostics", title: "Show Diagnostics", category: "View", run: showDiagnostics });
    mount(<ViewerPanel />);
    const pill = () => container.querySelector<HTMLButtonElement>('.sb-vw__footer-end button[data-tone="warn"]');
    expect(pill()).toBeNull();
    const loop = { code: "empty_loop", severity: "warning" as const, message: 'Layer "Event Card" has 0 copies because ...', component: "main", itemIds: ["card"] };
    const limit = { code: "loop_limit", severity: "warning" as const, message: "Too many.", component: "main", itemIds: [] };
    act(() => session.runtime.state.setState({ diagnostics: [loop] }));
    expect(pill()).toBeNull();
    act(() => session.runtime.state.setState({ diagnostics: [loop, limit] }));
    expect(pill()?.getAttribute("aria-label")).toContain("1 runtime warning");
    act(() => pill()!.click());
    expect(showDiagnostics).toHaveBeenCalledOnce();
  });

  it("keeps an empty_loop warning in the footer while the stale-state note, which doesn't name it, is showing", () => {
    mount(<ViewerPanel />);
    const pill = () => container.querySelector<HTMLButtonElement>('.sb-vw__footer-end button[data-tone="warn"]');
    const loop = { code: "empty_loop", severity: "warning" as const, message: 'Layer "Event Card" has 0 copies because ...', component: "main", itemIds: ["card"] };
    act(() => session.runtime.state.setState({ diagnostics: [loop], staleState: { layerId: "card", copies: 4 } }));
    expect(container.querySelector(".sb-vw__window-note")?.textContent).toContain("kept state from before your edit");
    expect(pill()?.getAttribute("aria-label")).toContain("1 runtime warning");
  });

  it("keeps saying Live while the prototype rests, and says so in place of a frame rate", () => {
    vi.useFakeTimers();
    try {
      mount(<ViewerPanel />);
      const status = () => container.querySelector<HTMLElement>(".sb-vw__pill[data-static]")!;
      const tip = () => {
        act(() => void status().dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })));
        act(() => void status().dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" })));
        act(() => void vi.advanceTimersByTime(600));
        return document.querySelector('[role="tooltip"]')?.textContent;
      };
      act(() => session.runtime.state.setState({ playing: true, resting: true, fps: 0 }));
      expect(status().textContent).toBe("Live");
      expect(tip()).toBe("At rest: nothing is moving");
      act(() => session.runtime.state.setState({ resting: false, fps: 60 }));
      expect(tip()).toBe("60 fps");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows no frame rate in the floating window while the prototype rests", () => {
    mount(<ViewerPanel />);
    chooseMore("Pop Out Viewer");
    act(() => session.runtime.state.setState({ playing: true, resting: true, fps: 0 }));
    expect(document.querySelector(".sb-float .sb-vw__pill[data-static]")?.textContent).toBe("Live");
  });

  it("lets keyboard users reach the frame count and fps tooltip on the status", () => {
    mount(<ViewerPanel />);
    expect(container.querySelector(".sb-vw__pill[data-static]")?.getAttribute("tabindex")).toBe("0");
  });

  it("puts notes over the stage, not in the layout", () => {
    mount(<ViewerPanel />);
    const loop = { code: "empty_loop", severity: "warning" as const, message: 'Layer "Event Card" has 0 copies because ...', component: "main", itemIds: ["card"] };
    act(() => session.runtime.state.setState({ diagnostics: [loop] }));
    const note = container.querySelector(".sb-vw__window-note")!;
    expect(note.closest(".sb-vw__notices")).not.toBeNull();
    expect(note.closest(".sb-vw__viewport")).not.toBeNull();
    const notices = container.querySelector(".sb-vw__notices")!;
    expect(notices.compareDocumentPosition(container.querySelector(".sb-vw__scroll")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("detaches into a floating window and docks back", () => {
    mount(<ViewerPanel />);
    chooseMore("Pop Out Viewer");
    expect(document.querySelector(".sb-float .sonobe-device")).not.toBeNull();
    expect(container.textContent).toContain("The viewer is floating");
    expect(document.querySelector('.sb-float button[aria-label="Restart prototype"]')).not.toBeNull();
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Dock viewer")!.click());
    expect(document.querySelector(".sb-float")).toBeNull();
    expect(container.querySelector(".sonobe-device")).not.toBeNull();
  });

  it("opens the host's viewer window, keeps it on top or closes it, and floats in-app when it can't open", async () => {
    type Status = { open: boolean; alwaysOnTop: boolean; error: string | null };
    let status: Status = { open: false, alwaysOnTop: false, error: null };
    const host = {
      popOutViewer: vi.fn(async (options?: { alwaysOnTop?: boolean }): Promise<Status> => (status = { open: true, alwaysOnTop: options?.alwaysOnTop ?? status.alwaysOnTop, error: null })),
      closeViewerWindow: vi.fn(async (): Promise<Status> => (status = { ...status, open: false })),
      getViewerWindowStatus: vi.fn(async () => status),
      onViewerWindowStatus: vi.fn(() => () => undefined),
    };
    (window as { sonobeHost?: unknown }).sonobeHost = host;
    mount(<ViewerPanel />);
    await flush();
    chooseMore("Open in New Window");
    await flush();
    expect(host.popOutViewer).toHaveBeenCalledOnce();
    expect(document.querySelector(".sb-float")).toBeNull();
    chooseMore("Keep Viewer Window on Top");
    await flush();
    expect(host.popOutViewer).toHaveBeenLastCalledWith({ alwaysOnTop: true });
    chooseMore("Close Viewer Window");
    await flush();
    expect(host.closeViewerWindow).toHaveBeenCalledOnce();
    host.popOutViewer.mockResolvedValueOnce({ open: false, alwaysOnTop: false, error: "No display is available." });
    chooseMore("Open in New Window");
    await flush();
    expect(document.querySelector(".sb-float .sonobe-device")).not.toBeNull();
  });

  it("registers viewer.layerBounds through the session's bounds registry", () => {
    const providers = new Map<string, BoundsProvider>();
    const off = vi.fn();
    (session as unknown as { bounds: unknown }).bounds = {
      register: vi.fn((method: string, provider: BoundsProvider) => {
        providers.set(method, provider);
        return off;
      }),
    };
    mount(<ViewerPanel />);
    expect(providers.has("viewer.layerBounds")).toBe(true);
    // happy-dom has no layout: nothing on screen has a size to capture.
    const provider = providers.get("viewer.layerBounds")!;
    expect(provider({ layerId: "card" })?.width ?? 0).toBe(0);
    expect(provider({ key: "card" })?.width ?? 0).toBe(0);
    expect(provider({})).toBeNull();
    mount(<div />);
    expect(off).toHaveBeenCalled();
  });

  it("guides empty prototypes", () => {
    mount(<ViewerPanel />);
    act(() => session.document.getState().newDocument());
    expect(container.querySelector(".sb-vw__empty-card")?.textContent).toContain("Nothing to show yet");
  });

  it("says what has no copies while an empty_loop warning is active, and Why? reveals it in Diagnostics", () => {
    const showDiagnostics = vi.fn();
    registry.register({ id: "view.showDiagnostics", title: "Show Diagnostics", category: "View", run: showDiagnostics });
    mount(<ViewerPanel />);
    const note = () => [...container.querySelectorAll<HTMLElement>(".sb-vw__window-note[data-tone=warn]")];
    expect(note()).toEqual([]);
    const warning = { code: "empty_loop", severity: "warning" as const, message: 'Layer "Event Card" has 0 copies because ...', component: "main", itemIds: ["card"] };
    const other = { code: "empty_loop", severity: "warning" as const, message: '"Swipe" (Component) has 0 copies because ...', component: "main", itemIds: ["tap_photo"] };
    act(() => session.runtime.state.setState({ diagnostics: [other, warning, { code: "loop_limit", severity: "warning", message: "Too many.", component: "main", itemIds: [] }] }));
    expect(note()).toHaveLength(1);
    expect(note()[0]!.getAttribute("role")).toBe("status");
    expect(note()[0]!.textContent).toBe("Event Card has no copies (+1 more)Why?");
    expect(note()[0]!.title).toContain('Layer "Event Card" has 0 copies');
    act(() => buttonWithText("Why?")!.click());
    expect(showDiagnostics).toHaveBeenCalled();
    expect(session.selection.getState().layers).toEqual(["card"]);
    act(() => session.runtime.state.setState({ diagnostics: [] }));
    expect(note()).toEqual([]);
  });

  it("offers Restart instead when an edit left state from before it", () => {
    mount(<ViewerPanel />);
    const note = () => [...container.querySelectorAll<HTMLElement>(".sb-vw__window-note[data-tone=warn]")];
    const warning = { code: "empty_loop", severity: "warning" as const, message: 'Layer "Event Card" has 0 copies because ...', component: "main", itemIds: ["card"] };
    act(() => session.runtime.state.setState({ diagnostics: [warning], staleState: { layerId: "card", copies: 4 } }));
    expect(note()).toHaveLength(1);
    expect(note()[0]!.textContent).toBe("The prototype kept state from before your editRestart");
    expect(note()[0]!.title).toBe("Started fresh, Event Card draws 4 copies. Restart to see your edit from the start.");
    const restarted = vi.fn();
    session.runtime.subscribeRestart(restarted);
    act(() => buttonWithText("Restart")!.click());
    expect(restarted).toHaveBeenCalledTimes(1);
    act(() => scheduler.frame());
    expect(session.runtime.state.getState().staleState).toBeNull();
    expect(note()[0]!.textContent).toBe("Event Card has no copiesWhy?");
  });
});
