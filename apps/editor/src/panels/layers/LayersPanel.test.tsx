// @vitest-environment happy-dom
import { applyOps, createEmptyDocument, findLayer, type Op, type SonobeDocument } from "@sonobe/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { createAssetService } from "../../state/assets.ts";
import { EditorProvider } from "../../state/EditorProvider.tsx";
import { getRegistry } from "../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { designStore } from "../design/designStore.ts";
import { dropTargetAt, patchEditorBridge } from "../patch-editor/index.ts";
import { planInsertLayer } from "./layerTree.ts";
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
  vi.restoreAllMocks();
});

function build(ops: Op[]): SonobeDocument {
  const result = applyOps(createEmptyDocument(), ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

const FIXTURE_OPS: Op[] = [
  { op: "addLayer", layer: { id: "a", type: "rectangle", name: "A", props: { position: [10, 10], size: [40, 40] } } },
  { op: "addLayer", layer: { id: "b", type: "rectangle", name: "B" } },
  { op: "addLayer", layer: { id: "group", type: "group", name: "Group", props: { size: [200, 100] }, children: [{ id: "g1", type: "oval", name: "Inner One" }, { id: "g2", type: "text", name: "Label" }] } },
  { op: "addLayer", layer: { id: "c", type: "text", name: "Title" } },
];

const fixture = () => build(FIXTURE_OPS);

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
const focusVisibly = (el: HTMLElement) => {
  const matches = el.matches.bind(el);
  Object.defineProperty(el, "matches", { value: (selector: string) => (selector === ":focus-visible" ? true : matches(selector)), configurable: true });
  act(() => el.focus());
};
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

function dragEvent(type: string, dataTransfer: unknown): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return event;
}

const fileTransfer = (files: File[]) => ({ types: ["Files"], files, items: files.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })), dropEffect: "none" });
const png = (seed: number, name: string) => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed, 2, 3])], name, { type: "image/png" });

async function eventually(check: () => void) {
  await act(async () => {
    await vi.waitFor(check, { timeout: 3000 });
  });
}

describe("LayersPanel", () => {
  it("lists layers front-most first and shows no breadcrumb at the root", () => {
    mount(fixture());
    expect(labels()).toEqual(["Title", "Group", "Label", "Inner One", "B", "A"]);
    expect(container.querySelector(".sb-layerspanel__component")).toBeNull();
    expect(container.querySelector('[aria-current="page"]')).toBeNull();
  });

  it("shows the path inside a component, with a landmark of its own", () => {
    const s = mount(build([...FIXTURE_OPS, { op: "addComponent", component: { id: "card", name: "Card", kind: "layerComponent" } }]));
    act(() => s.selection.getState().enterComponent("card"));
    const nav = container.querySelector('nav[aria-label="Layers component path"]')!;
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe("Card");
    expect(nav.querySelector("button")?.textContent).toBe("Main");
    expect(container.querySelector(".sb-layerspanel__kind")).toBeNull();
    click(button("Exit component"));
    expect(container.querySelector(".sb-layerspanel__component")).toBeNull();
  });

  it("keeps every Touch row on one line and explains the ambiguous ones in a tooltip", () => {
    mount(fixture());
    click(button("Touch: add an interaction to A", rowNamed("A")));
    const rows = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(rows.some((el) => el.querySelector(".sb-menu__description"))).toBe(false);
    focusVisibly(menuItem("Press"));
    expect(document.querySelector(".sb-tooltip")?.textContent).toBe("While the layer is held down");
    focusVisibly(menuItem("Tap"));
    expect(document.querySelector(".sb-tooltip")).toBeNull();
  });

  it("opens a Touch row's tooltip when the arrow keys reach it", () => {
    mount(fixture());
    click(button("Touch: add an interaction to A", rowNamed("A")));
    const keyDown = (key: string) => act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(menuItem("Tap"));
    keyDown("ArrowDown");
    expect(document.activeElement).toBe(menuItem("Press"));
    expect(document.querySelector(".sb-tooltip")?.textContent).toBe("While the layer is held down");
    keyDown("ArrowDown");
    expect(document.activeElement).toBe(menuItem("Long Press"));
    expect(document.querySelector(".sb-tooltip")?.textContent).toBe("After holding still for a moment");
    keyDown("ArrowDown");
    expect(document.activeElement).toBe(menuItem("Double Tap"));
    expect(document.querySelector(".sb-tooltip")).toBeNull();
  });

  it("puts the filter right under the header", () => {
    mount(fixture());
    const panel = container.querySelector(".sb-panel")!;
    expect(panel.querySelector("footer")).toBeNull();
    const field = container.querySelector<HTMLInputElement>('input[aria-label="Filter layers"]')!;
    expect(field.placeholder).toBe("Filter layers");
    expect(container.querySelector(".sb-layerspanel")!.firstElementChild!.contains(field)).toBe(true);
    expect(button("Filter by type")).not.toBeNull();
  });

  it("draws no chevrons while a filter is active", () => {
    mount(fixture());
    expect(container.querySelectorAll(".sb-tree__chevron[data-visible]").length).toBeGreaterThan(0);
    type(container.querySelector<HTMLInputElement>('input[aria-label="Filter layers"]')!, "label");
    expect(container.querySelectorAll(".sb-tree__chevron[data-visible]")).toHaveLength(0);
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

  it("clears the selection on Escape in the tree and on a click in its empty area", () => {
    const s = mount(fixture());
    act(() => s.selection.getState().select({ layers: ["a"] }));
    const tree = container.querySelector<HTMLElement>(".sb-tree")!;
    const escape = () => act(() => void tree.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    escape();
    expect(s.selection.getState().layers).toEqual([]);
    act(() => s.selection.getState().select({ layers: ["b", "c"] }));
    pointer(container.querySelector(".sb-tree__canvas") ?? tree, "pointerdown");
    expect(s.selection.getState().layers).toEqual([]);
  });

  it("leaves Escape alone in the tree when nothing is selected", () => {
    const s = mount(fixture());
    const tree = container.querySelector<HTMLElement>(".sb-tree")!;
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => void tree.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(s.selection.getState().layers).toEqual([]);
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

  it("badges layers that make copies (with a repeat icon when Repeat decides) and layers with a Z Position", () => {
    mount(
      build([
        { op: "addPatch", patch: { id: "names", type: "loopBuilder", typeParam: "text", inputCount: 4, ui: { x: 0, y: 0 } } },
        { op: "addPatch", patch: { id: "dots", type: "loop", inputs: { count: 3 }, ui: { x: 0, y: 200 } } },
        { op: "addLayer", layer: { id: "card", type: "group", name: "Card", props: { zPosition: 2 }, children: [{ id: "title", type: "text", name: "Card Title" }] } },
        { op: "addLayer", layer: { id: "dot", type: "oval", name: "Dot" } },
        { op: "addLayer", layer: { id: "plain", type: "rectangle", name: "Plain" } },
        { op: "setInput", target: "@card.repeat", value: { link: "names.loop" } },
        { op: "connect", from: "names.loop", to: "@title.text" },
        { op: "connect", from: "dots.index", to: "@dot.opacity" },
      ]),
    );
    const badges = (name: string) => [...rowNamed(name).querySelectorAll(".sb-layerspanel__badge")].map((b) => [b.getAttribute("data-kind"), b.textContent, !!b.querySelector("svg")]);
    expect(badges("Card")).toEqual([
      ["copies", "×4", true],
      ["z", "z2", false],
    ]);
    expect(rowNamed("Card").querySelector('[data-kind="copies"]')!.getAttribute("aria-label")).toBe("Repeat makes 4 copies, and everything inside follows.");
    // A child follows its parent's copies; it doesn't make its own.
    expect(badges("Card Title")).toEqual([]);
    expect(badges("Dot")).toEqual([["copies", "×3", false]]);
    expect(badges("Plain")).toEqual([]);
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
    expect(container.textContent).toContain("No matching layers for “nothing like this”");
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Clear")!);
    expect(labels()).toHaveLength(6);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Filter layers"]')!.value).toBe("");
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

  const openRowMenu = (name: string) =>
    act(() => {
      rowNamed(name).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    });
  const menuTitles = () => [...document.querySelectorAll('[role="menu"] > [role="menuitem"]')].map((el) => el.querySelector(".sb-menu__title")?.textContent);

  it("lists Rename after Duplicate and Redesign after Reveal in the row menu, and Rename starts the inline editor", () => {
    const s = mount(fixture());
    openRowMenu("B");
    const titles = menuTitles();
    expect(titles.indexOf("Rename")).toBe(titles.indexOf("Duplicate") + 1);
    expect(titles.indexOf("Redesign with Claude…")).toBe(titles.indexOf("Reveal in Patch Editor") + 1);
    expect(menuItem("Rename").querySelector(".sb-menu__shortcut")).not.toBeNull();
    click(menuItem("Rename"));
    const input = container.querySelector<HTMLInputElement>(".sb-tree__rename")!;
    expect(input.value).toBe("B");
    type(input, "Hero");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(findLayer(main(s).layers, "b")!.layer.name).toBe("Hero");
  });

  it("enters a component instance on double-click anywhere on its row instead of renaming it", () => {
    const s = mount(build([...FIXTURE_OPS, { op: "addComponent", component: { id: "card", name: "Card", kind: "layerComponent" } }, { op: "addLayer", layer: { id: "inst", type: "componentInstance", name: "Card Instance", component: "card" } }]));
    act(() => {
      rowNamed("Card Instance").querySelector(".sb-tree__label")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(container.querySelector(".sb-tree__rename")).toBeNull();
    expect(s.selection.getState().componentPath.at(-1)).toBe("card");
  });

  it("lists Group with the basic layers and says why Component Instance is disabled in a tooltip", () => {
    const s = mount(fixture());
    click(button("Insert layer"));
    const labelsIn = () => [...document.querySelectorAll(".sb-menu__label")].map((el) => el.textContent);
    expect(labelsIn()).not.toContain("Containers");
    expect(menuItem("Group")).toBeTruthy();
    const instance = menuItem("Component Instance");
    expect(instance.getAttribute("aria-disabled")).toBe("true");
    expect(instance.textContent).toBe("Component Instance");
    expect(instance.querySelector(".sb-menu__description")).toBeNull();
    focusVisibly(instance);
    expect(document.querySelector(".sb-tooltip")?.textContent).toContain("No layer components yet");
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    act(() => s.selection.getState().select({ layers: ["a"] }));
    click(button("Insert layer"));
    const anchor = [...document.querySelectorAll<HTMLElement>(".sb-menu__label")].find((el) => el.textContent?.startsWith("Insert above"))!;
    expect(anchor.textContent).toBe("Insert above “A”");
    expect(anchor.hasAttribute("data-plain")).toBe(true);
  });

  it("scrolls the virtualized list to a layer selected elsewhere", () => {
    const bulk = Array.from({ length: 200 }, (_, i): Op => ({ op: "addLayer", layer: { id: `bulk_${i}`, type: "rectangle", name: `Bulk ${i}` } }));
    const s = mount(build(bulk));
    const tree = container.querySelector<HTMLElement>(".sb-tree")!;
    expect(tree.scrollTop).toBe(0);
    act(() => s.selection.getState().select({ layers: ["bulk_20"] }));
    const top = tree.scrollTop;
    expect(top).toBeGreaterThan(0);
    act(() => s.selection.getState().select({ layers: ["bulk_199"] }));
    expect(tree.scrollTop).toBeLessThan(top);
  });

  it("redesigns one layer with Claude from the row menu: it selects the row and opens the box", () => {
    const s = mount(fixture());
    designStore.setState({ open: false });
    const openMenu = (name: string) =>
      act(() => {
        rowNamed(name).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
      });
    act(() => s.selection.getState().select({ layers: ["a", "b"] }));
    openMenu("A");
    const several = menuItem("Redesign with Claude…");
    expect(several.getAttribute("aria-disabled")).toBe("true");
    expect(several.querySelector(".sb-menu__description")?.textContent).toBe("Select one layer");
    click(several);
    expect(designStore.getState().open).toBe(false);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    act(() => s.selection.getState().select({ layers: ["c"] }));
    openMenu("Label");
    click(menuItem("Redesign with Claude…"));
    expect(s.selection.getState().layers).toEqual(["g2"]);
    expect(designStore.getState().open).toBe(true);
    designStore.setState({ open: false });
  });

  it("turns every row into a cable drop target while a patch editor drags a cable", () => {
    const s = mount(fixture());
    expect(container.querySelector("[data-sb-layer-drop]")).toBeNull();
    act(() => patchEditorBridge(s).getState().setCableDrag({ component: "main", from: "pop.output", type: "number" }));
    // The rows themselves carry the drop markers (TreeView getRowProps); the overlay shows what accepts the cable.
    expect(rowNamed("A").getAttribute("data-sb-layer-drop")).toBe("a");
    expect(rows().every((row) => row.hasAttribute("data-sb-layer-drop"))).toBe(true);
    const overlay = rowNamed("A").querySelector<HTMLElement>('.sb-layerspanel__drop[data-kind="cable"]')!;
    expect(overlay).not.toBeNull();
    expect(overlay.getAttribute("data-accept")).toBe("true");
    expect(dropTargetAt(overlay)).toEqual({ kind: "layer", layerId: "a" });
    expect(dropTargetAt(rowNamed("A").querySelector(".sb-tree__label"))).toEqual({ kind: "layer", layerId: "a" });

    act(() => {
      overlay.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 3, clientY: 3 }));
    });
    expect(overlay.getAttribute("data-hover")).toBe("true");
    expect(overlay.textContent).toBe("Choose a property");

    act(() => patchEditorBridge(s).getState().setCableDrag({ component: "main", from: "tap.layer", type: "layer" }));
    expect(rowNamed("A").querySelector('.sb-layerspanel__drop[data-kind="cable"]')!.hasAttribute("data-accept")).toBe(false);

    act(() => patchEditorBridge(s).getState().setCableDrag({ component: "elsewhere", from: "pop.output", type: "number" }));
    expect(container.querySelector("[data-sb-layer-drop]")).toBeNull();
    act(() => patchEditorBridge(s).getState().setCableDrag(null));
    expect(container.querySelector("[data-sb-layer-drop]")).toBeNull();
  });

  it("replaces a media layer's content with a dropped file, and turns other drops into media layers", async () => {
    const s = mount(build([...FIXTURE_OPS, { op: "addLayer", layer: { id: "photo", type: "image", name: "Photo", props: { size: [120, 80] } } }]));
    const service = createAssetService({ document: s.document, host: null, probe: async () => ({ width: 400, height: 300 }) });
    vi.spyOn(s.assets, "importFile").mockImplementation((file, options) => service.importFile(file, options));

    const photoRow = rowNamed("Photo");
    act(() => {
      photoRow.dispatchEvent(dragEvent("dragover", fileTransfer([png(1, "sunset.png")])));
    });
    expect(photoRow.querySelector('.sb-layerspanel__drop[data-kind="file"]')?.textContent).toBe("Replace image in Photo");
    await act(async () => {
      photoRow.dispatchEvent(dragEvent("drop", fileTransfer([png(1, "sunset.png")])));
    });
    await eventually(() => expect(findLayer(main(s).layers, "photo")!.layer.props.image).toEqual({ asset: "sunset" }));
    expect(container.querySelector('.sb-layerspanel__drop[data-kind="file"]')).toBeNull();

    await act(async () => {
      rowNamed("Group").dispatchEvent(dragEvent("drop", fileTransfer([png(2, "hero.png")])));
    });
    await eventually(() => expect(findLayer(main(s).layers, "group")!.layer.children).toHaveLength(3));
    const hero = findLayer(main(s).layers, "group")!.layer.children!.at(-1)!;
    expect(hero).toMatchObject({ type: "image", name: "hero", props: { image: { asset: "hero" }, size: [133, 100] } });
    expect(s.selection.getState().layers).toEqual([hero.id]);

    const body = container.querySelector<HTMLElement>(".sb-layerspanel__body")!;
    act(() => {
      body.dispatchEvent(dragEvent("dragover", fileTransfer([png(3, "logo.png")])));
    });
    expect(body.getAttribute("data-file-drop")).toBe("panel");
    expect(container.querySelector(".sb-layerspanel__filedrop")?.textContent).toBe("Add image");
    await act(async () => {
      body.dispatchEvent(dragEvent("drop", fileTransfer([png(3, "logo.png")])));
    });
    await eventually(() => expect(main(s).layers.at(-1)).toMatchObject({ type: "image", name: "logo" }));
    expect(body.hasAttribute("data-file-drop")).toBe(false);
  });
});

describe("LayersPanel in a patch component", () => {
  it("offers no layer inserts and explains why, so no invisible layers get added", () => {
    const s = mount(build([...FIXTURE_OPS, { op: "addComponent", component: { id: "logic", name: "Logic", kind: "patchComponent" } }]));
    act(() => s.selection.getState().enterComponent("logic"));
    expect(container.textContent).toContain("Patch components hold logic only.");
    expect([...container.querySelectorAll("button")].some((b) => ["Rectangle", "Text", "Image"].includes(b.textContent?.trim() ?? ""))).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Insert layer"]')!.disabled).toBe(true);
    expect(planInsertLayer(s.document.getState().doc, "logic", registry, "rectangle")).toBeUndefined();
    expect(planInsertLayer(s.document.getState().doc, "main", registry, "rectangle")).toBeDefined();
  });
});

