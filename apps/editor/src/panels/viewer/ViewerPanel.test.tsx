// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManualScheduler, type ManualScheduler } from "../../runtime/scheduler.ts";
import { EditorProvider } from "../../state/EditorProvider.tsx";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { CommandProvider } from "../../ui/commands/CommandProvider.tsx";
import { CommandRegistry } from "../../ui/commands/commandRegistry.ts";
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

const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

describe("ViewerPanel", () => {
  it("draws the prototype inside a device frame", () => {
    mount(<ViewerPanel />);
    expect(container.querySelector(".sonobe-device[data-frame=on]")).not.toBeNull();
    expect(container.querySelector(".sonobe-device .sonobe-stage")?.childElementCount).toBeGreaterThan(0);
    expect(container.querySelector(".sb-vw__pill")?.textContent).toContain("Paused");
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

  it("rotates through setProject as one undoable change", () => {
    mount(<ViewerPanel />);
    act(() => button("Rotate to landscape")!.click());
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
    expect(button("On phone") ?? [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("On phone"))).toBeUndefined();
    mount(<ViewerPanel lanPreviewUrl="http://192.168.0.2:5204/p" />);
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.includes("On phone"))).toBe(true);
    expect(registry.isEnabled("viewer.previewOnDevice")).toBe(true);
  });

  it("detaches into a floating window and docks back", () => {
    mount(<ViewerPanel />);
    act(() => button("Pop out viewer")!.click());
    expect(document.querySelector(".sb-float .sonobe-device")).not.toBeNull();
    expect(container.textContent).toContain("The viewer is floating");
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Dock viewer")!.click());
    expect(document.querySelector(".sb-float")).toBeNull();
    expect(container.querySelector(".sonobe-device")).not.toBeNull();
  });

  it("guides empty prototypes", () => {
    mount(<ViewerPanel />);
    act(() => session.document.getState().newDocument());
    expect(container.querySelector(".sb-vw__empty-card")?.textContent).toContain("Nothing to show yet");
  });
});
