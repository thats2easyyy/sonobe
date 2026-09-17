// @vitest-environment happy-dom
import { applyOps, createEmptyDocument, findLayer, type Op, type SonobeDocument } from "@sonobe/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { EditorProvider } from "../../state/EditorProvider.tsx";
import { getRegistry } from "../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { LayersPanel } from "./LayersPanel.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const registry = getRegistry();
let container: HTMLDivElement;
let root: Root;
let session: EditorSession | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  session?.dispose();
  session = null;
});

function build(ops: Op[]): SonobeDocument {
  const result = applyOps(createEmptyDocument(), ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

const fixture = () =>
  build([
    { op: "addLayer", layer: { id: "a", type: "rectangle", name: "A", props: { position: [10, 10], size: [40, 40] } } },
    { op: "addLayer", layer: { id: "b", type: "rectangle", name: "B" } },
    { op: "addLayer", layer: { id: "group", type: "group", name: "Group", children: [{ id: "g1", type: "oval", name: "Inner One" }, { id: "g2", type: "text", name: "Label" }] } },
    { op: "addLayer", layer: { id: "c", type: "text", name: "Title" } },
  ]);

function mount(doc: SonobeDocument): EditorSession {
  session = createEditorSession({ host: null, registry, document: doc, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  const s = session;
  act(() =>
    root.render(
      <EditorProvider session={s} commands={false} clipboardEvents={false} rpc={false}>
        <LayersPanel />
      </EditorProvider>,
    ),
  );
  return s;
}

const main = (s: EditorSession) => s.document.getState().doc.components.main!;
const rows = () => [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')];
const labels = () => rows().map((r) => r.querySelector(".sb-tree__label")?.textContent);
const rowNamed = (name: string) => rows().find((r) => r.querySelector(".sb-tree__label")?.textContent === name)!;
const button = (label: string, scope: ParentNode = container) => scope.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')].find((el) => el.querySelector(".sb-menu__title")?.textContent === label)!;

function pointer(target: Element, type: "pointerdown" | "pointerup", init: PointerEventInit = {}) {
  act(() => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: 0, clientY: 0, ...init }));
  });
}

function type(input: HTMLInputElement, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(target: Element | null) {
  act(() => {
    (target as HTMLElement).click();
  });
}

describe("LayersPanel", () => {
  it("lists layers front-most first under the component breadcrumb", () => {
    mount(fixture());
    expect(labels()).toEqual(["Title", "Group", "Label", "Inner One", "B", "A"]);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("Main");
    expect(container.querySelector(".sb-layerspanel__kind")?.textContent).toBe("Prototype");
  });

  it("selects rows into the selection store and follows external selection", () => {
    const s = mount(fixture());
    pointer(rowNamed("B"), "pointerdown");
    pointer(rowNamed("B"), "pointerup");
    expect(s.selection.getState().layers).toEqual(["b"]);
    pointer(rowNamed("A"), "pointerdown", { shiftKey: true });
    expect(s.selection.getState().layers).toEqual(["b", "a"]);
    act(() => s.selection.getState().select({ layers: ["c"] }));
    expect(rowNamed("Title").getAttribute("aria-selected")).toBe("true");
    expect(rowNamed("B").getAttribute("aria-selected")).toBe("false");
  });

  it("hides, shows, and locks layers from the row buttons", () => {
    const s = mount(fixture());
    click(button("Hide A", rowNamed("A")));
    expect(findLayer(main(s).layers, "a")!.layer.props.enabled).toBe(false);
    expect(s.document.getState().undoLabel).toBe("You: Hide A");
    click(button("Show A", rowNamed("A")));
    expect(findLayer(main(s).layers, "a")!.layer.props.enabled).toBeUndefined();
    click(button("Lock B", rowNamed("B")));
    expect(findLayer(main(s).layers, "b")!.layer.locked).toBe(true);
    expect(rowNamed("B").querySelector('[aria-label="Locked"]')).not.toBeNull();
  });

  it("renames a layer in place", () => {
    const s = mount(fixture());
    act(() => {
      rowNamed("B").querySelector(".sb-tree__label")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    const input = container.querySelector<HTMLInputElement>(".sb-tree__rename")!;
    type(input, "Hero");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(findLayer(main(s).layers, "b")!.layer.name).toBe("Hero");
    expect(labels()).toContain("Hero");
  });

  it("filters by name and keeps the path to matches", () => {
    mount(fixture());
    type(container.querySelector<HTMLInputElement>('input[aria-label="Filter layers"]')!, "label");
    expect(labels()).toEqual(["Group", "Label"]);
    type(container.querySelector<HTMLInputElement>('input[aria-label="Filter layers"]')!, "nothing like this");
    expect(container.textContent).toContain("No matching layers");
  });

  it("highlights a layer hovered in another panel and reports its own hover", () => {
    const s = mount(fixture());
    act(() => s.selection.getState().setHovered({ kind: "layer", id: "b", component: "main", source: "viewer" }));
    expect(rowNamed("B").querySelector(".sb-layerspanel__hover")).not.toBeNull();
    act(() => {
      rowNamed("A").dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    expect(s.selection.getState().hovered).toMatchObject({ kind: "layer", id: "a", source: "layers" });
  });

  it("expands collapsed groups to reveal a layer selected elsewhere", () => {
    const s = mount(fixture());
    act(() => {
      (rowNamed("Group").querySelector(".sb-tree__chevron") as HTMLElement).click();
    });
    expect(labels()).toEqual(["Title", "Group", "B", "A"]);
    act(() => s.selection.getState().select({ layers: ["g1"] }));
    expect(labels()).toContain("Inner One");
  });

  it("offers friendly first steps when the component is empty", () => {
    const s = mount(createEmptyDocument());
    expect(container.textContent).toContain("No layers yet");
    const rectangle = [...container.querySelectorAll("button")].find((b) => b.textContent === "Rectangle")!;
    click(rectangle);
    expect(main(s).layers.map((l) => l.type)).toEqual(["rectangle"]);
    expect(s.selection.getState().layers).toEqual([main(s).layers[0]!.id]);
  });

  it("inserts any layer type from the + menu in front of the selection", () => {
    const s = mount(fixture());
    act(() => s.selection.getState().select({ layers: ["a"] }));
    click(button("Insert layer"));
    expect(menuItem("Video")).toBeTruthy();
    click(menuItem("Oval"));
    expect(main(s).layers.map((l) => l.id).slice(0, 2)).toEqual(["a", s.selection.getState().layers[0]]);
    expect(s.document.getState().undoLabel).toBe("You: Add Oval");
  });

  it("adds a pre-wired interaction from the Touch button", () => {
    const s = mount(fixture());
    click(button("Touch: add an interaction to A", rowNamed("A")));
    click(menuItem("Drag"));
    const patches = Object.entries(main(s).patches);
    expect(patches).toHaveLength(1);
    const [id, patch] = patches[0]!;
    expect(patch).toMatchObject({ type: "drag", inputs: { layer: { layer: "a" }, startPosition: [10, 10] } });
    expect(findLayer(main(s).layers, "a")!.layer.props.position).toEqual({ link: `${id}.position` });
    expect(s.selection.getState().reveal).toMatchObject({ component: "main", ids: [id] });
  });

  it("runs edit actions from the context menu", () => {
    const s = mount(fixture());
    act(() => {
      rowNamed("B").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    });
    expect(s.selection.getState().layers).toEqual(["b"]);
    click(menuItem("Duplicate"));
    expect(main(s).layers.map((l) => l.id)).toEqual(["a", "b", "b_2", "group", "c"]);
    act(() => {
      rowNamed("A").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    });
    click(menuItem("Group"));
    expect(main(s).layers.map((l) => l.type)).toContain("group");
    expect(findLayer(main(s).layers, "a")!.parent?.name).toBe("Group");
  });
});
