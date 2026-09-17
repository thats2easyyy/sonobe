// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler, type ManualScheduler } from "../../runtime/scheduler.ts";
import { EditorProvider } from "../../state/EditorProvider.tsx";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { CommandProvider } from "../../ui/commands/CommandProvider.tsx";
import { CommandRegistry } from "../../ui/commands/commandRegistry.ts";
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
  it("draws the prototype inside a device frame", () => {
    mount(<ViewerPanel />);
    expect(container.querySelector(".sonobe-device[data-frame=on]")).not.toBeNull();
    expect(container.querySelector(".sonobe-device .sonobe-stage")?.childElementCount).toBeGreaterThan(0);
    expect(container.querySelector(".sb-vw__pill")?.textContent).toContain("Paused");
  });

  it("keeps zoom, restart, frame, and hit targets in the header, with no second device picker", () => {
    mount(<ViewerPanel onCollapse={() => undefined} />);
    const header = container.querySelector(".sb-panel__header")!;
    expect(header.querySelector('[aria-label="Device"]')).toBeNull();
    expect(header.querySelector('[aria-label^="Viewer zoom:"]')).not.toBeNull();
    for (const label of ["Restart prototype", "Device frame", "Show hit targets", "More viewer options", "Hide viewer"]) {
      expect(header.querySelector(`[aria-label="${label}"]`), label).not.toBeNull();
    }
    expect(header.querySelector(".sb-vw__device-name")?.textContent).toBeTruthy();
    const restart = vi.spyOn(session.runtime, "restart");
    act(() => button("Restart prototype")!.click());
    expect(restart).toHaveBeenCalledOnce();
  });

  it("switches between fit and 1:1 from the zoom menu", () => {
    mount(<ViewerPanel />);
    expect(container.querySelector(".sb-vw__scroll")?.getAttribute("data-zoom")).toBe("fit");
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label^="Viewer zoom:"]')!.click());
    act(() => menuItem("Actual Size (1:1)")!.click());
    expect(container.querySelector(".sb-vw__scroll")?.getAttribute("data-zoom")).toBe("actual");
    expect(document.querySelector('button[aria-label="Viewer zoom: 1:1"]')).not.toBeNull();
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
    act(() => listener?.({ ...RUNNING, clients: 3 }));
    expect(buttonWithText("On phone")!.textContent).toContain("3");
    await act(async () => {
      buttonWithText("Stop phone preview")!.click();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(host.stopPreview).toHaveBeenCalledOnce();
    expect(buttonWithText("Start phone preview")).toBeDefined();
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
});
