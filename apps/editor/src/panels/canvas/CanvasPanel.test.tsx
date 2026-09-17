// @vitest-environment happy-dom
import { findLayer } from "@sonobe/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { EditorProvider } from "../../state/EditorProvider.tsx";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { CommandProvider } from "../../ui/commands/CommandProvider.tsx";
import { CommandRegistry } from "../../ui/commands/commandRegistry.ts";
import { KeyboardShortcutManager } from "../../ui/commands/shortcutManager.ts";
import { CanvasPanel } from "./CanvasPanel.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no layout: give the canvas body a size so the artboard fits at zoom 1, offset (199, 63).
const sizeDescriptors = { width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"), height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight") };
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return (this as HTMLElement).classList?.contains("sb-cv") ? 800 : 0; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return (this as HTMLElement).classList?.contains("sb-cv") ? 1000 : 0; } });
});
afterAll(() => {
  if (sizeDescriptors.width) Object.defineProperty(HTMLElement.prototype, "clientWidth", sizeDescriptors.width);
  if (sizeDescriptors.height) Object.defineProperty(HTMLElement.prototype, "clientHeight", sizeDescriptors.height);
});

let container: HTMLDivElement;
let root: Root;
let session: EditorSession;
let registry: CommandRegistry;
let shortcuts: KeyboardShortcutManager;

beforeEach(() => {
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
  session.dispose();
  container.remove();
  document.body.innerHTML = "";
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

const position = (id: string) => findLayer(session.document.getState().doc.components.main!.layers, id)!.layer.props.position;

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

  it("explains patch components instead of drawing", () => {
    mount();
    act(() => {
      const result = session.document.getState().apply([{ op: "addComponent", ref: "logic", component: { name: "Logic", kind: "patchComponent" } }], { label: "Add component" });
      session.selection.getState().setComponentPath(["main", result.idMap.logic!]);
    });
    expect(container.textContent).toContain("Nothing to draw here");
  });
});
