// @vitest-environment happy-dom
import { allLayers, findLayer } from "@sonobe/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { layoutStore } from "../../shell/layoutStore.ts";
import { EditorProvider } from "../../state/EditorProvider.tsx";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { CommandProvider } from "../../ui/commands/CommandProvider.tsx";
import { CommandRegistry } from "../../ui/commands/commandRegistry.ts";
import { KeyboardShortcutManager } from "../../ui/commands/shortcutManager.ts";
import { designStore, initialDesignData, type DesignDraft } from "../design/designStore.ts";
import { CanvasPanel } from "./CanvasPanel.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no layout: give the canvas body a size so the artboard fits at zoom 1, offset (199, 73): 34 px of room above it, for its label, and 14 below.
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
  layoutStore.getState().setViewMode("split");
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
const at = (x: number, y: number) => ({ clientX: 199 + x, clientY: 73 + y });

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

/** Report that `target` changed size. Size observers report on the next animation frame (ui/lib/observeResize.ts), so run that frame too. */
function observeResized(target: Element) {
  const frames: FrameRequestCallback[] = [];
  const requestFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  try {
    act(() => {
      for (const o of observers) if (o.targets.includes(target)) o.callback([], {} as ResizeObserver);
    });
  } finally {
    globalThis.requestAnimationFrame = requestFrame;
  }
  act(() => {
    for (const callback of frames.splice(0)) callback(performance.now());
  });
}

/** Resize the canvas body. */
function resize(width: number, height: number) {
  bodySize = [width, height];
  observeResized(body());
}

/** The artboard's translate(x, y) in CSS pixels. */
const artboardOffset = () => {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(container.querySelector<HTMLElement>(".sb-cv__artboard")!.style.transform);
  return match ? [Number(match[1]), Number(match[2])] : null;
};

/** The artboard's zoom (its width over the 402 pt artboard). */
const artboardZoom = () => parseFloat(container.querySelector<HTMLElement>(".sb-cv__artboard")!.style.width) / 402;

/** The live preview's translate(x, y). */
const previewOffset = () => {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(container.querySelector<HTMLElement>(".sb-design-preview")!.style.transform);
  return match ? [Number(match[1]), Number(match[2])] : null;
};

/** Where the fit puts the 402 × 874 artboard in a canvas of `size`: 34 px of room above it and 14 below, 24 beside. */
function fitRectOffset(size: [number, number]): [number, number] {
  const zoom = Math.min(1, (size[0] - 48) / 402, (size[1] - 48) / 874);
  return [(size[0] - 402 * zoom) / 2, 34 + (size[1] - 48 - 874 * zoom) / 2];
}

const position = (id: string) => findLayer(session.document.getState().doc.components.main!.layers, id)!.layer.props.position;

const designButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="Design with Claude"]')!;

const CLAUDE_CODE = { id: "cc-1", label: "Claude Code", folder: "/Users/me/placemark" };

/** A draft on the canvas: Claude Code's preview_design by default. */
const draftOf = (over: Partial<DesignDraft> = {}): DesignDraft => ({
  source: "mcp",
  key: "mcp:cc-1",
  runId: "",
  turn: 0,
  toolUseId: "",
  html: "<p>Checkout</p>",
  fields: { name: "Checkout" },
  status: "writing",
  since: Date.now(),
  progress: null,
  error: null,
  resync: false,
  mcp: { author: { kind: "agent", name: "Claude" }, client: CLAUDE_CODE, draftRevision: 1, touchedAt: Date.now(), addingFrom: null },
  ...over,
});
const showDraft = (draft: DesignDraft) => act(() => designStore.setState({ drafts: [draft] }));

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

  it("marks focus as keyboard focus only when it did not come from a pointer", () => {
    mount();
    act(() => body().focus());
    expect(body().hasAttribute("data-kbd")).toBe(true);
    pointer("pointerdown", at(200, 520));
    expect(body().hasAttribute("data-kbd")).toBe(false);
    pointer("pointerup", at(200, 520));

    act(() => body().blur());
    pointer("pointerdown", at(200, 520));
    pointer("pointerup", at(200, 520));
    expect(document.activeElement).toBe(body());
    expect(body().hasAttribute("data-kbd")).toBe(false);
  });

  it("hides the size label of a selection much narrower than the label", () => {
    mount();
    pointer("pointerdown", at(200, 520));
    pointer("pointerup", at(200, 520));
    expect(container.querySelector(".sb-cv__pill")?.textContent).toBe("370 × 440");
    const outlineHeight = () => {
      const ys = container.querySelector(".sb-cv__outline")!.getAttribute("points")!.split(" ").map((p) => Number(p.split(",")[1]));
      return Math.max(...ys) - Math.min(...ys);
    };
    for (let i = 0; i < 40 && container.querySelector(".sb-cv__pill"); i++) act(() => void registry.run("canvas.zoomOut"));
    // The label goes while the card is still taller than a pill: it would be wider than twice the card.
    expect(container.querySelector(".sb-cv__pill")).toBeNull();
    expect(outlineHeight()).toBeGreaterThan(16);
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
    expect(artboardOffset()).toEqual([199, 73]);
    expect(registry.get("canvas.toggleRulers")?.shortcut).toBe("Shift+R");
    act(() => {
      registry.run("canvas.toggleRulers");
    });
    expect(container.querySelectorAll(".sb-cv__ruler")).toHaveLength(2);
    expect(container.querySelector(".sb-cv__ruler-corner")).not.toBeNull();
    expect(localStorage.getItem("sonobe.canvas.rulers")).toBe("on");
    // The 874 pt artboard still fits in 980 − 48 px of room, shifted past the 20 px rulers.
    expect(artboardOffset()).toEqual([209, 83]);
  });

  it("re-fits when the panel resizes, until someone zooms; then keeps the center", () => {
    mount();
    expect(artboardOffset()).toEqual([199, 73]);
    resize(1000, 1000);
    expect(artboardOffset()).toEqual([299, 73]);
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
    expect(artboardOffset()).toEqual([299, 73]);
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
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(container.querySelector(".sb-cv__zoom")).toBeNull();
    // Beside the patch editor the copy points at it; on its own, a button brings it back.
    expect(container.textContent).not.toContain("Show Patches");
    act(() => layoutStore.getState().setViewMode("canvas"));
    const show = [...container.querySelectorAll("button")].find((b) => b.textContent === "Show Patches")!;
    act(() => show.click());
    expect(layoutStore.getState().viewMode).toBe("split");
  });

  it("hides the empty screen's hint while the Design box is open", async () => {
    mount();
    act(() => {
      const store = session.document.getState();
      store.apply(
        store.doc.components.main!.layers.map((l) => ({ op: "removeLayer" as const, component: "main", id: l.id })),
        { label: "Clear" },
      );
    });
    expect(container.querySelector(".sb-cv__hint")).not.toBeNull();
    act(() => designButton().click());
    await openedBox();
    expect(container.querySelector(".sb-cv__hint")).toBeNull();
  });

  it("shows Group only while something is selected, and toggles the Design box from its header button", async () => {
    mount();
    const group = () => container.querySelector('button[aria-label="Group selection"]');
    expect(group()).toBeNull();
    act(() => session.selection.getState().select({ layers: ["card"] }));
    expect(group()).not.toBeNull();
    act(() => session.selection.getState().clear());
    expect(group()).toBeNull();

    expect(designButton().getAttribute("aria-pressed")).toBe("false");
    expect(designButton().textContent).toBe("Design");
    act(() => designButton().click());
    expect(designButton().getAttribute("aria-pressed")).toBe("true");
    await openedBox();
    act(() => designButton().click());
    expect(designStore.getState().open).toBe(false);
    expect(designButton().getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(body());
  });

  it("draws the grid on the artboard's steps, following pan and zoom", () => {
    mount();
    const before = [body().style.backgroundSize, body().style.backgroundPosition];
    expect(parseFloat(before[0]!)).toBeGreaterThanOrEqual(12);
    act(() => {
      body().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 130, ...at(200, 300) }));
    });
    expect(body().style.backgroundPosition).not.toBe(before[1]);
    act(() => {
      registry.run("canvas.actualSize");
    });
    expect(body().style.backgroundSize).toBe("20px 20px");
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
    expect(link.closest(".sb-cv__hint")?.textContent).toBe("Empty screenDraw with R, O or T, or let Claude draft one.Describe a screen");
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

  it("says what Claude Code is writing in the artboard's label, instead of repeating what it's doing there", () => {
    mount();
    const label = () => container.querySelector<HTMLElement>(".sb-cv__label")!;
    act(() => {
      session.presence.getState().begin({ intent: "designing a checkout screen", author: { kind: "agent", name: "Claude" }, client: CLAUDE_CODE });
    });
    expect(label().textContent).toContain("Claude Code: designing a checkout screen");
    showDraft(draftOf());
    expect(label().querySelector("[data-design-pill]")?.textContent).toBe("Claude Code is writing “Checkout”");
    expect(label().textContent).not.toContain("designing a checkout screen");
    expect(container.querySelector(".sb-design-preview [data-design-pill]")).toBeNull();

    // Over a layer further down, the pill sits above the frame.
    showDraft(draftOf({ fields: { name: "Card", replace: "card" } }));
    expect(container.querySelector(".sb-design-preview__pill")?.getAttribute("data-place")).toBe("above");
    expect(label().querySelector("[data-design-pill]")).toBeNull();

    // Once the draft is gone, the presence pill says what it's doing again.
    showDraft(draftOf({ status: "stopped", since: Date.now() - 1000 }));
    expect(label().textContent).toContain("Claude Code: designing a checkout screen");
  });

  it("draws the preview over the layer it replaces as that layer moves or comes back with undo", () => {
    mount();
    showDraft(draftOf({ fields: { name: "Card", replace: "card" } }));
    const expectOverCard = () => {
      const [ax, ay] = artboardOffset()!;
      const [cx, cy] = position("card") as [number, number];
      const [px, py] = previewOffset()!;
      expect(px).toBeCloseTo(ax + cx * artboardZoom(), 0);
      expect(py).toBeCloseTo(ay + cy * artboardZoom(), 0);
    };
    expectOverCard();
    act(() => {
      session.document.getState().apply([{ op: "updateLayer", component: "main", id: "card", props: { position: [100, 300] } }], { label: "Move card" });
    });
    expect(position("card")).toEqual([100, 300]);
    expectOverCard();
    act(() => {
      session.document.getState().undo();
    });
    expect(position("card")).toEqual([16, 146]);
    expectOverCard();
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

describe("CanvasPanel with the Design with Claude box", () => {
  // happy-dom has no layout: the box's height is what it reports, through offsetHeight.
  let boxHeight = 300;
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

  beforeEach(() => {
    boxHeight = 300;
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return (this as HTMLElement).classList?.contains("sb-design-box") ? boxHeight : 0; } });
  });
  afterEach(() => {
    if (offsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
  });

  async function openDesignBox() {
    act(() => designButton().click());
    await openedBox();
  }

  /** The box gets taller (a status line, Claude's reply and chips, a confirm card). */
  function growBox(height: number) {
    boxHeight = height;
    observeResized(container.querySelector(".sb-design-box")!);
  }

  const boxMax = () => container.querySelector<HTMLElement>(".sb-panel")!.style.getPropertyValue("--sb-design-box-max");

  it("fits the artboard above the box while it's open, and keeps that room as the box grows", async () => {
    mount();
    // Fitted in the whole body: 402 × 874 at zoom 1, centered.
    expect(artboardOffset()).toEqual([199, 73]);
    await openDesignBox();
    // Above the box (300 px, 16 px from the bottom, a 12 px gap): the 672 px left, less 28 px of padding each side.
    const zoom = (672 - 56) / 874;
    const [x, y] = artboardOffset()!;
    expect(x).toBeCloseTo((800 - 402 * zoom) / 2, 0);
    expect(y).toBeCloseTo((672 - 874 * zoom) / 2, 0);
    // The box may grow until 200 px of canvas are left above it; then its reply and cards scroll.
    expect(boxMax()).toBe(`${1000 - 28 - 200}px`);

    // A status line, then Claude's reply and chips: the artboard stays where it is.
    const fitted = artboardOffset();
    growBox(360);
    growBox(460);
    expect(artboardOffset()).toEqual(fitted);

    // In a canvas too small for that room, the box is held at 250 px, and the artboard fits in what is left above it.
    resize(800, 450);
    expect(artboardZoom()).toBeCloseTo((450 - 278 - 56) / 874, 3);
    expect(artboardOffset()![1]).toBeCloseTo(28, 0);
    expect(boxMax()).toBe("250px");

    resize(800, 1000);
    act(() => designStore.getState().closeBox());
    expect(artboardOffset()).toEqual([199, 73]);
    expect(boxMax()).toBe("");
  });

  it("caps a box that opens taller than the room, so the artboard stays above it", async () => {
    boxHeight = 600;
    bodySize = [800, 450];
    mount();
    await openDesignBox();
    expect(boxMax()).toBe("250px");
    // The box is held at 250 px, and the artboard fits above it, less 28 px of padding on each side.
    expect(artboardZoom()).toBeCloseTo((450 - 278 - 56) / 874, 3);
    expect(artboardOffset()![1] + 874 * artboardZoom()).toBeLessThanOrEqual(450 - 278);

    // A canvas with more room lets it grow until 200 px are left above it.
    resize(800, 800);
    expect(boxMax()).toBe(`${800 - 28 - 200}px`);
  });

  it("zooms to the selection above the Design box, and right of and below the rulers", async () => {
    mount();
    await openDesignBox();
    act(() => session.selection.getState().select({ layers: ["card"] }));
    act(() => {
      registry.run("canvas.zoomToSelection");
    });
    // The card is 370 × 440 at (16, 146); the room above the 300 px box is 800 × 672, with 12% of it as padding.
    const padding = 0.12 * 672;
    const zoom = artboardZoom();
    expect(zoom).toBeCloseTo((672 - padding * 2) / 440, 3);
    const [x, y] = artboardOffset()!;
    expect(y + 146 * zoom).toBeGreaterThanOrEqual(padding - 1);
    expect(y + (146 + 440) * zoom).toBeLessThanOrEqual(672 - padding + 1);
    expect(x + (16 + 185) * zoom).toBeCloseTo(400, 0);

    act(() => designStore.getState().closeBox());
    act(() => {
      registry.run("canvas.toggleRulers");
    });
    act(() => {
      registry.run("canvas.zoomToSelection");
    });
    // With the rulers on, the card is centered in what is right of and below them.
    const [rx, ry] = artboardOffset()!;
    expect(rx + (16 + 185) * artboardZoom()).toBeCloseTo(20 + (800 - 20) / 2, 0);
    expect(ry + (146 + 220) * artboardZoom()).toBeCloseTo(20 + (1000 - 20) / 2, 0);
  });

  it("fits the first page of a draft at a size you can read, top first, and keeps it as the screen lands", async () => {
    bodySize = [800, 600];
    mount();
    await openDesignBox();
    // The whole artboard above the box: 272 px, so about 25%.
    expect(artboardZoom()).toBeCloseTo((272 - 56) / 874, 3);

    // Claude starts writing a new screen: its width fits, at most 100%, with its top at the top.
    showDraft(draftOf({ source: "assistant", key: "t1", runId: "r1", turn: 1, toolUseId: "t1", mcp: undefined }));
    expect(artboardZoom()).toBe(1);
    expect(artboardOffset()).toEqual([199, 28]);
    showDraft(draftOf({ source: "assistant", key: "t1", runId: "r1", turn: 1, toolUseId: "t1", mcp: undefined, html: "<p>Checkout</p><p>Pay</p>" }));
    growBox(340);

    // The screen lands, selected and revealed, and the box shows the result: nothing moves.
    act(() => {
      session.document.getState().apply([{ op: "addLayer", component: "main", layer: { id: "checkout", type: "rectangle", name: "Checkout", props: { position: [0, 0], size: [402, 874] } } }], { label: "Import Design" });
      designStore.setState({ drafts: [draftOf({ source: "assistant", key: "t1", runId: "r1", turn: 1, toolUseId: "t1", mcp: undefined, status: "added" })] });
      session.selection.getState().select({ layers: ["checkout"] });
      session.selection.getState().requestReveal("main", ["checkout"]);
    });
    growBox(420);
    expect(artboardZoom()).toBe(1);
    expect(artboardOffset()).toEqual([199, 28]);
  });

  it("gives the artboard its fit back at the next resize once a draft has landed, and never fits a layer that's gone", async () => {
    bodySize = [800, 400];
    mount();
    await openDesignBox();
    const assistantDraft = (over: Partial<DesignDraft> = {}) => draftOf({ source: "assistant", key: "t1", runId: "r1", turn: 1, toolUseId: "t1", mcp: undefined, ...over });
    showDraft(assistantDraft());
    expect(artboardZoom()).toBe(1);
    expect(artboardOffset()).toEqual([199, 28]);
    act(() => {
      session.document.getState().apply([{ op: "addLayer", component: "main", layer: { id: "checkout", type: "rectangle", name: "Checkout", props: { position: [0, 0], size: [402, 874] } } }], { label: "Import Design" });
      designStore.setState({ drafts: [assistantDraft({ status: "added" })] });
      session.selection.getState().select({ layers: ["checkout"] });
      session.selection.getState().requestReveal("main", ["checkout"]);
    });
    expect(artboardOffset()).toEqual([199, 28]);

    // Closing the box fits the whole artboard again, not the page Claude wrote.
    act(() => designStore.getState().closeBox());
    expect(artboardZoom()).toBeCloseTo((400 - 48) / 874, 3);
    expect(artboardOffset()![1]).toBeCloseTo(fitRectOffset([800, 400])[1], 0);

    // Claude Code redesigns the card with the box closed, and the card is deleted after it lands: a resize fits the artboard.
    showDraft(draftOf({ fields: { name: "Card", replace: "card" } }));
    // The card is 370 × 440: its fit is 288 / 440.
    expect(artboardZoom()).toBeCloseTo(288 / 440, 3);
    showDraft(draftOf({ fields: { name: "Card", replace: "card" }, status: "added", since: Date.now() }));
    act(() => {
      session.document.getState().apply([{ op: "removeLayer", component: "main", id: "card" }], { label: "Delete" });
    });
    resize(800, 500);
    expect(artboardZoom()).toBeCloseTo((500 - 48) / 874, 3);
    expect(artboardOffset()![1]).toBeCloseTo(fitRectOffset([800, 500])[1], 0);
  });

  it("fits the part of a draft's frame on the artboard, or the artboard when the frame is off it, since the canvas and viewer show only the artboard", () => {
    bodySize = [800, 400];
    mount();
    // Claude Code puts a new screen beside the artboard: the artboard's width fits, top first, not the empty canvas beside it.
    const beside = { name: "Settings", position: [482, 0] as [number, number] };
    showDraft(draftOf({ fields: beside }));
    expect(artboardZoom()).toBe(1);
    expect(artboardOffset()).toEqual([199, 56]);
    // It lands there, selected and revealed: nothing moves.
    act(() => {
      session.document.getState().apply([{ op: "addLayer", component: "main", layer: { id: "settings", type: "rectangle", name: "Settings", props: { position: beside.position, size: [402, 874] } } }], { label: "Import Design" });
      designStore.setState({ drafts: [draftOf({ fields: beside, status: "added" })] });
      session.selection.getState().select({ layers: ["settings"] });
      session.selection.getState().requestReveal("main", ["settings"]);
    });
    expect(artboardOffset()).toEqual([199, 56]);

    // A frame half on the artboard: the half that shows fits.
    showDraft(draftOf({ key: "mcp:cc-2", fields: { name: "Promo", position: [200, 0] } }));
    expect(artboardZoom()).toBe(1);
    expect(artboardOffset()).toEqual([(800 - 202) / 2 - 200, 56]);
  });

  it("fits a redesign over the layer it replaces, even one waiting off the artboard to slide in", () => {
    bodySize = [800, 400];
    mount();
    act(() => {
      session.document.getState().apply([{ op: "addLayer", component: "main", layer: { id: "profile", type: "rectangle", name: "Profile", props: { position: [402, 0], size: [402, 874] } } }], { label: "Add" });
    });
    showDraft(draftOf({ fields: { name: "Profile", replace: "profile" } }));
    // The preview Claude is writing is in view: the layer's width fits, top first, where it waits.
    expect(artboardZoom()).toBe(1);
    expect(artboardOffset()).toEqual([(800 - 402) / 2 - 402, 56]);
    expect(previewOffset()).toEqual([(800 - 402) / 2, 56]);
  });

  it("measures a repeated layer's first copy for the preview, its fit and the box's prompt", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
    mount();
    const rows = { loop: [[0, 0], [0, 100], [0, 200]] };
    act(() => {
      session.document.getState().apply(
        [
          { op: "addLayer", component: "main", layer: { id: "row", type: "rectangle", name: "Row", props: { position: rows, size: [200, 80] } } },
          { op: "addLayer", component: "main", layer: { id: "label", type: "text", name: "Label", props: { text: "Row", position: rows } } },
        ],
        { label: "Add rows" },
      );
    });
    // Claude Code redesigns the row: the preview draws over its first copy, not all three, and the fit centers that copy.
    showDraft(draftOf({ fields: { name: "Row", replace: "row" } }));
    const preview = container.querySelector<HTMLElement>(".sb-design-preview")!;
    expect([parseFloat(preview.style.width), parseFloat(preview.style.height)]).toEqual([200 * artboardZoom(), 80 * artboardZoom()]);
    expect(artboardOffset()).toEqual([(800 - 200) / 2, (1000 - 80) / 2]);

    // The box's prompt gives the size of one copy of a text layer (drawn, not typed).
    act(() => designStore.setState(initialDesignData()));
    act(() => session.selection.getState().select({ layers: ["label"], patches: [], comments: [] }));
    await openDesignBox();
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>(".sb-design-box button")].find((b) => b.textContent === "Copy prompt")!.click();
      await Promise.resolve();
    });
    const size = /redesign layer label \(([\d.]+) × ([\d.]+),/.exec(copied[0] ?? "");
    expect(size).not.toBeNull();
    expect(Number(size![2])).toBeGreaterThan(0);
    expect(Number(size![2])).toBeLessThan(100);
  });

  it("fits Claude Code's draft with the box closed, gives the artboard's fit back when nothing was added, and leaves a viewport someone moved", () => {
    bodySize = [800, 400];
    mount();
    const whole = artboardZoom();
    expect(whole).toBeCloseTo((400 - 48) / 874, 3);
    showDraft(draftOf());
    expect(artboardZoom()).toBe(1);
    expect(artboardOffset()).toEqual([199, 56]);

    showDraft(draftOf({ status: "stopped", since: Date.now() }));
    expect(artboardZoom()).toBeCloseTo(whole, 3);

    act(() => {
      registry.run("canvas.zoomIn");
    });
    const zoomed = [artboardZoom(), ...artboardOffset()!];
    showDraft(draftOf({ key: "mcp:cc-2" }));
    expect([artboardZoom(), ...artboardOffset()!]).toEqual(zoomed);
  });

  it("fits a draft that was already being written when the canvas appeared, as when a patches-only layout makes room", () => {
    bodySize = [800, 400];
    showDraft(draftOf());
    mount();
    expect(artboardZoom()).toBe(1);
    expect(artboardOffset()).toEqual([199, 56]);
  });
});
