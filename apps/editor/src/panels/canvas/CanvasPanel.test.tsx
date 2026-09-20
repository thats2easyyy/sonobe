// @vitest-environment happy-dom
import { allLayers, findLayer } from "@sonobe/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { EditorProvider } from "../../state/EditorProvider.tsx";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { CommandProvider } from "../../ui/commands/CommandProvider.tsx";
import { CommandRegistry } from "../../ui/commands/commandRegistry.ts";
import { KeyboardShortcutManager } from "../../ui/commands/shortcutManager.ts";
import { designStore, initialDesignData } from "../design/designStore.ts";
import { CanvasPanel } from "./CanvasPanel.tsx";

// The Design with Claude box asks these of the design state package while it's open: stand-ins for its stubs.
vi.mock("../design/context.ts", () => ({ designTarget: () => null, canvasContext: () => ({ component: { id: "main", name: "Main", size: [402, 874] }, screens: [] }) }));
vi.mock("../design/status.ts", () => ({ designStatusLine: () => null, toolStatusText: () => "" }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no layout: give the canvas body a size so the artboard fits at zoom 1, offset (199, 63).
let bodySize: [number, number] = [800, 1000];
const sizeDescriptors = { width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"), height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight") };
const OriginalResizeObserver = globalThis.ResizeObserver;
const observers: { callback: ResizeObserverCallback; targets: Element[] }[] = [];

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return (this as HTMLElement).classList?.contains("sb-cv") ? bodySize[0] : 0; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return (this as HTMLElement).classList?.contains("sb-cv") ? bodySize[1] : 0; } });
  globalThis.ResizeObserver = class {
    readonly entry: { callback: ResizeObserverCallback; targets: Element[] };
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, targets: [] };
      observers.push(this.entry);
    }
    observe(target: Element) {
      this.entry.targets.push(target);
    }
    unobserve() {}
    disconnect() {
      this.entry.targets = [];
    }
  } as unknown as typeof ResizeObserver;
});
// The canvas loads the Design with Claude box on first open; load its module up front so a test doesn't wait on the transform.
beforeAll(async () => {
  await import("../design/DesignBox.tsx");
}, 60_000);
afterAll(() => {
  if (sizeDescriptors.width) Object.defineProperty(HTMLElement.prototype, "clientWidth", sizeDescriptors.width);
  if (sizeDescriptors.height) Object.defineProperty(HTMLElement.prototype, "clientHeight", sizeDescriptors.height);
  globalThis.ResizeObserver = OriginalResizeObserver;
});

let container: HTMLDivElement;
let root: Root;
let session: EditorSession;
let registry: CommandRegistry;
let shortcuts: KeyboardShortcutManager;

beforeEach(() => {
  bodySize = [800, 1000];
  observers.length = 0;
  localStorage.setItem("sonobe.canvas.rulers", "off");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  session = createEditorSession({ host: null, scheduler: createManualScheduler(), textMeasurer: "approximate", autoplay: false });
  registry = new CommandRegistry();
  shortcuts = new KeyboardShortcutManager({ platform: "mac" });
  shortcuts.setContextScopes(["canvas"]);
});

afterEach(() => {
  act(() => root.unmount());
  designStore.setState(initialDesignData());
  session.dispose();
  container.remove();
  document.body.innerHTML = "";
  localStorage.removeItem("sonobe.canvas.rulers");
});

function mount(ui: ReactNode = <CanvasPanel />) {
  act(() => {
    root.render(
      <CommandProvider registry={registry} shortcuts={shortcuts} attach={false}>
        <EditorProvider session={session} rpc={false} clipboardEvents={false}>
          {ui}
        </EditorProvider>
      </CommandProvider>,
    );
  });
}

const body = () => container.querySelector<HTMLElement>(".sb-cv")!;
/** Artboard point → client point for the fitted viewport. */
const at = (x: number, y: number) => ({ clientX: 199 + x, clientY: 63 + y });

function pointer(type: string, point: { clientX: number; clientY: number }, init: PointerEventInit = {}) {
  act(() => {
    body().dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, buttons: type === "pointerup" ? 0 : 1, ...point, ...init }));
  });
}

function dragEvent(type: string, point: { clientX: number; clientY: number }, dataTransfer: unknown) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { clientX: { value: point.clientX }, clientY: { value: point.clientY }, dataTransfer: { value: dataTransfer } });
  body().dispatchEvent(event);
  return event;
}

/** Resize the canvas body. Size observers report on the next animation frame (ui/lib/observeResize.ts), so run that frame too. */
function resize(width: number, height: number) {
  bodySize = [width, height];
  const frames: FrameRequestCallback[] = [];
  const requestFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  try {
    act(() => {
      for (const o of observers) if (o.targets.includes(body())) o.callback([], {} as ResizeObserver);
    });
  } finally {
    globalThis.requestAnimationFrame = requestFrame;
  }
  act(() => {
    for (const callback of frames.splice(0)) callback(performance.now());
  });
}

/** The artboard's translate(x, y) in CSS pixels. */
const artboardOffset = () => {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(container.querySelector<HTMLElement>(".sb-cv__artboard")!.style.transform);
  return match ? [Number(match[1]), Number(match[2])] : null;
};

const position = (id: string) => findLayer(session.document.getState().doc.components.main!.layers, id)!.layer.props.position;

const designButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="Design with Claude"]')!;

/** The box, once its lazily loaded module has arrived and React has rendered it. */
async function openedBox(): Promise<HTMLElement> {
  for (let i = 0; i < 100 && !container.querySelector(".sb-design-box"); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  const box = container.querySelector<HTMLElement>(".sb-design-box");
  expect(box).not.toBeNull();
  return box!;
}

describe("CanvasPanel", () => {
  it("renders the artboard and registers canvas commands", () => {
    mount();
    expect(container.querySelector(".sb-cv__artboard .sonobe-stage")?.childElementCount).toBeGreaterThan(0);
    expect(container.querySelector(".sb-cv__label")?.textContent).toContain("402 × 874");
    expect(registry.get("canvas.tool.rectangle")?.shortcut).toBe("R");
    act(() => {
      registry.run("canvas.tool.rectangle");
    });
    expect(body().dataset.tool).toBe("rectangle");
  });

  it("selects on click and moves on drag as one undo entry", () => {
    mount();
    pointer("pointerdown", at(200, 520));
    pointer("pointerup", at(200, 520));
    expect(session.selection.getState().layers).toEqual(["card"]);
    expect(container.querySelectorAll(".sb-cv__handle")).toHaveLength(8);

    pointer("pointerdown", at(200, 520));
    for (let i = 1; i <= 6; i++) pointer("pointermove", at(200 + i * 5, 520 + i * 5), { metaKey: true });
    pointer("pointerup", at(230, 550));
    expect(position("card")).toEqual([46, 176]);
    expect(session.document.getState().historyEntries().map((e) => e.label)).toEqual(["Move Event Card"]);
  });

  it("⌥-drag duplicates: the copy moves, the original stays, and one undo removes the copy", () => {
    mount();
    pointer("pointerdown", at(200, 520));
    pointer("pointerup", at(200, 520));
    const count = () => allLayers(session.document.getState().doc.components.main!.layers).length;
    const before = count();
    pointer("pointerdown", at(200, 520), { altKey: true });
    for (let i = 1; i <= 6; i++) pointer("pointermove", at(200 + i * 5, 520 + i * 5), { metaKey: true, altKey: true });
    pointer("pointerup", at(230, 550), { altKey: true });
    expect(position("card")).toEqual([16, 146]);
    const copy = session.selection.getState().layers[0]!;
    expect(copy).not.toBe("card");
    expect(position(copy)).toEqual([46, 176]);
    expect(count()).toBeGreaterThan(before);
    expect(session.document.getState().historyEntries().map((e) => e.label)).toEqual(["Duplicate Event Card"]);
    act(() => {
      session.document.getState().undo();
    });
    expect(count()).toBe(before);
    expect(position("card")).toEqual([16, 146]);
  });

  it("inserting a text layer and typing is one undo step that keeps the new layer's id", () => {
    mount();
    act(() => {
      registry.run("canvas.tool.text");
    });
    const frames: FrameRequestCallback[] = [];
    const requestFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (callback) => frames.push(callback);
    try {
      pointer("pointerdown", at(40, 820));
      pointer("pointerup", at(40, 820));
    } finally {
      globalThis.requestAnimationFrame = requestFrame;
    }
    const inserted = session.selection.getState().layers[0]!;
    act(() => {
      for (const callback of frames.splice(0)) callback(performance.now());
    });
    const editor = container.querySelector<HTMLTextAreaElement>(".sb-cv__text-editor")!;
    editor.value = "Hello";
    act(() => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(session.selection.getState().layers).toEqual([inserted]);
    expect(findLayer(session.document.getState().doc.components.main!.layers, inserted)!.layer.props.text).toBe("Hello");
    expect(session.document.getState().historyEntries().map((e) => e.label)).toEqual(["Insert Text"]);
  });

  it("Escape during an ⌥-drag leaves no copy behind", () => {
    mount();
    pointer("pointerdown", at(200, 520));
    pointer("pointerup", at(200, 520));
    const before = allLayers(session.document.getState().doc.components.main!.layers).length;
    pointer("pointerdown", at(200, 520), { altKey: true });
    for (let i = 1; i <= 4; i++) pointer("pointermove", at(200 + i * 5, 520 + i * 5), { altKey: true });
    act(() => {
      shortcuts.handleKeyDown(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(allLayers(session.document.getState().doc.components.main!.layers).length).toBe(before);
    expect(position("card")).toEqual([16, 146]);
    expect(session.document.getState().historyEntries()).toEqual([]);
  });

  it("nudges with arrows (⇧ ×10) and Escape clears the selection", () => {
    mount();
    act(() => session.selection.getState().select({ layers: ["card"] }));
    act(() => {
      shortcuts.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true }));
      shortcuts.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    });
    expect(position("card")).toEqual([26, 145]);
    act(() => {
      shortcuts.handleKeyDown(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(session.selection.getState().layers).toEqual([]);
  });

  it("draws a rectangle with the insert tool and returns to select", () => {
    mount();
    act(() => {
      registry.run("canvas.tool.rectangle");
    });
    pointer("pointerdown", at(30, 20));
    pointer("pointermove", at(90, 50));
    pointer("pointermove", at(130, 60));
    pointer("pointerup", at(130, 60));
    const id = session.selection.getState().layers[0]!;
    const layer = findLayer(session.document.getState().doc.components.main!.layers, id)!.layer;
    expect(layer).toMatchObject({ type: "rectangle", props: { size: [100, 40] } });
    expect(session.document.getState().undoLabel).toBe("You: Insert Rectangle");
    expect(body().dataset.tool).toBe("select");
  });

  it("toggles rulers (⇧R) and re-fits the artboard around them", () => {
    mount();
    expect(container.querySelector(".sb-cv__ruler")).toBeNull();
    expect(artboardOffset()).toEqual([199, 63]);
    expect(registry.get("canvas.toggleRulers")?.shortcut).toBe("Shift+R");
    act(() => {
      registry.run("canvas.toggleRulers");
    });
    expect(container.querySelectorAll(".sb-cv__ruler")).toHaveLength(2);
    expect(container.querySelector(".sb-cv__ruler-corner")).not.toBeNull();
    expect(localStorage.getItem("sonobe.canvas.rulers")).toBe("on");
    // 980 − 112 px of room for an 874 pt artboard: zoom 0.993, shifted past the 20 px rulers.
    expect(artboardOffset()).toEqual([210, 76]);
  });

  it("re-fits when the panel resizes, until someone zooms; then keeps the center", () => {
    mount();
    expect(artboardOffset()).toEqual([199, 63]);
    resize(1000, 1000);
    expect(artboardOffset()).toEqual([299, 63]);
    act(() => {
      registry.run("canvas.zoomIn");
    });
    const zoomed = artboardOffset()!;
    resize(800, 900);
    const after = artboardOffset()!;
    expect(after[0]).toBeCloseTo(zoomed[0] - 100, -0.5);
    expect(after[1]).toBeCloseTo(zoomed[1] - 50, -0.5);
    act(() => {
      registry.run("canvas.zoomToFit");
    });
    resize(1000, 1000);
    expect(artboardOffset()).toEqual([299, 63]);
  });

  it("adds dropped images as layers through the session's asset importer", async () => {
    const importFile = vi.fn(async (file: File) => ({ id: "sunset", kind: "image", name: file.name, file: "sunset.png", width: 800, height: 600 }));
    (session as unknown as { assets: unknown }).assets = { import: importFile };
    mount();
    const file = new File([new Uint8Array([137, 80, 78, 71])], "sunset.png", { type: "image/png" });
    const dataTransfer = { types: ["Files"], files: [file], items: [{ kind: "file", type: "image/png" }], dropEffect: "none" };
    let over: Event;
    act(() => {
      over = dragEvent("dragover", at(200, 100), dataTransfer);
    });
    expect(over!.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(container.querySelector(".sb-cv__drop-target")).not.toBeNull();
    expect(container.querySelector(".sb-cv__drop-label")?.textContent).toBe("Add image");

    await act(async () => {
      dragEvent("drop", at(200, 100), dataTransfer);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(importFile).toHaveBeenCalledOnce();
    const doc = session.document.getState().doc;
    expect(doc.assets.sunset).toMatchObject({ kind: "image", file: "sunset.png" });
    const id = session.selection.getState().layers[0]!;
    expect(findLayer(doc.components.main!.layers, id)!.layer).toMatchObject({ type: "image", name: "sunset", props: { image: { asset: "sunset" }, size: [402, 302], position: [-1, -51] } });
    expect(session.document.getState().historyEntries().map((e) => e.label)).toEqual(["Add image “sunset”"]);
    expect(container.querySelector(".sb-cv__drop-target")).toBeNull();
  });

  it("ignores drags without files and leaves the document alone for unsupported files", async () => {
    mount();
    act(() => {
      expect(dragEvent("dragover", at(200, 100), { types: ["text/plain"], items: [], files: [] }).defaultPrevented).toBe(false);
    });
    expect(container.querySelector(".sb-cv__drop-target")).toBeNull();
    const pdf = new File(["%PDF"], "notes.pdf", { type: "application/pdf" });
    await act(async () => {
      dragEvent("drop", at(200, 100), { types: ["Files"], files: [pdf], items: [{ kind: "file", type: "application/pdf" }] });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(session.document.getState().historyEntries()).toHaveLength(0);
  });

  it("registers canvas.bounds with the session's bounds registry for screenshots", async () => {
    mount();
    expect(session.bounds.methods()).toContain("canvas.bounds");
    // happy-dom reports a zero-size client rect: there's nothing to capture.
    expect(await session.bounds.measure("canvas.bounds")).toBeNull();
    mount(<div />);
    expect(session.bounds.methods()).not.toContain("canvas.bounds");
  });

  it("explains patch components instead of drawing", () => {
    mount();
    act(() => {
      const result = session.document.getState().apply([{ op: "addComponent", ref: "logic", component: { name: "Logic", kind: "patchComponent" } }], { label: "Add component" });
      session.selection.getState().setComponentPath(["main", result.idMap.logic!]);
    });
    expect(container.textContent).toContain("Nothing to draw here");
    expect(designButton().disabled).toBe(true);
  });

  it("opens the Design with Claude box from the header, outside the canvas's pointer and wheel gestures", async () => {
    mount();
    expect(designButton().disabled).toBe(false);
    act(() => designButton().click());
    expect(designStore.getState().open).toBe(true);
    const designBox = await openedBox();
    expect(designBox.closest(".sb-cv")).toBeNull();
    expect(designBox.parentElement?.classList.contains("sb-panel__body")).toBe(true);

    act(() => session.selection.getState().select({ layers: ["card"] }));
    const before = artboardOffset();
    act(() => {
      designBox.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, buttons: 1, ...at(10, 700) }));
      designBox.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, buttons: 1, ...at(300, 820) }));
    });
    pointer("pointermove", at(320, 840));
    expect(container.querySelector(".sb-cv__marquee")).toBeNull();
    act(() => {
      designBox.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, button: 0, buttons: 0, ...at(300, 820) }));
    });
    // A press on the canvas's empty space would have started a marquee and cleared the selection.
    expect(session.selection.getState().layers).toEqual(["card"]);

    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120, ...at(200, 700) });
    act(() => {
      designBox.dispatchEvent(wheel);
    });
    expect(wheel.defaultPrevented).toBe(false);
    expect(artboardOffset()).toEqual(before);
    // The same wheel over the canvas pans it.
    act(() => {
      body().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120, ...at(200, 300) }));
    });
    expect(artboardOffset()).not.toEqual(before);
  });

  it("opens the box from the empty artboard's hint, which starts no canvas gesture", async () => {
    mount();
    act(() => {
      const store = session.document.getState();
      store.apply(
        store.doc.components.main!.layers.map((l) => ({ op: "removeLayer" as const, component: "main", id: l.id })),
        { label: "Clear" },
      );
    });
    const link = container.querySelector<HTMLButtonElement>(".sb-cv__hint-action")!;
    expect(link.closest(".sb-cv__hint")?.textContent).toBe("Draw a rectangle (R), an oval (O), or text (T), or describe a screen to Claude");
    act(() => {
      link.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, buttons: 1, ...at(201, 437) }));
    });
    pointer("pointermove", at(20, 20));
    expect(container.querySelector(".sb-cv__marquee")).toBeNull();
    pointer("pointerup", at(20, 20));
    act(() => link.click());
    expect(designStore.getState().open).toBe(true);
    await openedBox();
  });

  it("shows another agent's work in the artboard label, but not the Assistant's", () => {
    mount();
    const pill = () => container.querySelector(".sb-cv__label-agent")?.textContent ?? null;
    act(() => {
      session.presence.getState().begin({ intent: "designing a checkout screen", author: { kind: "agent", name: "Assistant" } });
    });
    expect(pill()).toBeNull();
    let work = "";
    act(() => {
      work = session.presence.getState().begin({ intent: "designing a checkout screen", author: { kind: "agent", name: "Claude" }, client: { id: "s1", label: "Claude Code", folder: "/Users/me/placemark" } });
    });
    expect(pill()).toBe("Claude Code: designing a checkout screen");
    act(() => {
      session.presence.getState().finish(work);
      session.presence.getState().begin({ intent: "rebuilding the settings screen with every toggle from the SwiftUI view", author: { kind: "agent", name: "Claude" } });
    });
    expect(pill()).toBe("Claude: rebuilding the settings screen with every toggle fr…");
    expect(pill()!.length).toBe(60);
  });
});
