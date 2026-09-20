// @vitest-environment happy-dom
import { applyOps, createEmptyDocument, findLayer, getPatchSpec, resolveNodePorts, type Op, type SonobeDocument } from "@sonobe/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { layoutStore } from "../../shell/layoutStore.ts";
import { createAssetService } from "../../state/assets.ts";
import { EditorProvider } from "../../state/EditorProvider.tsx";
import { getRegistry } from "../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { completeConnectionToLayerProp, dropTargetAt, patchEditorBridge } from "../patch-editor/index.ts";
import { InspectorPanel } from "./InspectorPanel.tsx";
import { activePreset } from "./spring.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const registry = getRegistry();
let container: HTMLDivElement;
let root: Root;
let session: EditorSession | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  session?.dispose();
  session = null;
  vi.restoreAllMocks();
  layoutStore.getState().setViewMode("split");
});

function build(ops: Op[], doc: SonobeDocument = createEmptyDocument()): SonobeDocument {
  const result = applyOps(doc, ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

const fixture = () =>
  build([
    { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card", props: { position: [16, 146], size: [370, 440], opacity: 0.5 } } },
    { op: "addLayer", layer: { id: "dot", type: "oval", name: "Dot", props: { opacity: 0.8 } } },
    { op: "addLayer", layer: { id: "hero", type: "image", name: "Hero" } },
    { op: "addPatch", patch: { id: "grow", type: "transition", typeParam: "number", inputs: { start: 1, end: 1.2 }, ui: { x: 0, y: 0 } } },
    { op: "addPatch", patch: { id: "pop", type: "popAnimation", typeParam: "number", ui: { x: 0, y: 200 } } },
    { op: "addPatch", patch: { id: "sum", type: "add", typeParam: "number", ui: { x: 0, y: 400 } } },
    { op: "connect", from: "pop.output", to: "grow.progress" },
    { op: "connect", from: "grow.output", to: "@card.scale" },
  ]);

function mount(doc: SonobeDocument, props: Parameters<typeof InspectorPanel>[0] = {}): EditorSession {
  session = createEditorSession({ host: null, registry, document: doc, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  const s = session;
  act(() =>
    root.render(
      <EditorProvider session={s} commands={false} clipboardEvents={false} rpc={false}>
        <InspectorPanel {...props} />
      </EditorProvider>,
    ),
  );
  return s;
}

const main = (s: EditorSession) => s.document.getState().doc.components.main!;
const input = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const buttonWithText = (text: string, scope: ParentNode = container) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;
const rowNamed = (name: string) => [...container.querySelectorAll<HTMLElement>(".sb-insp-row")].find((row) => row.querySelector(".sb-insp-row__name")?.textContent === name)!;
const option = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((el) => el.querySelector(".sb-selectmenu__label")?.textContent === label)!;
const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.querySelector(".sb-menu__title")?.textContent === label)!;
const png = (seed: number, name: string) => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed, 2, 3])], name, { type: "image/png" });

function type(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(el: Element, name: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  });
}

function click(el: Element | null | undefined) {
  act(() => {
    (el as HTMLElement).click();
  });
}

const select = (s: EditorSession, items: { layers?: string[]; patches?: string[] }) => act(() => s.selection.getState().select(items));

/** Imports without DOM media decoding (happy-dom can't decode images). */
function stubAssets(s: EditorSession) {
  const service = createAssetService({ document: s.document, host: null, probe: async () => ({ width: 64, height: 48 }) });
  return vi.spyOn(s.assets, "importFile").mockImplementation((file, options) => service.importFile(file, options));
}

function dragEvent(type: string, dataTransfer: unknown): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return event;
}

const fileTransfer = (files: File[]) => ({ types: ["Files"], files, items: files.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })), dropEffect: "none" });

async function eventually(check: () => void) {
  await act(async () => {
    await vi.waitFor(check, { timeout: 3000 });
  });
}

describe("InspectorPanel", () => {
  it("shows a friendly empty state with the component's notes", () => {
    const s = mount(fixture());
    expect(container.textContent).toContain("Nothing selected");
    expect(container.textContent).toContain("3 layers · 3 patches");
    const notes = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Component notes"]')!;
    type(notes, "Tap the card to grow it.");
    act(() => notes.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    act(() => notes.dispatchEvent(new FocusEvent("blur")));
    expect(main(s).notes).toBe("Tap the card to grow it.");
  });

  it("generates sections for a layer and edits a value with one undo step", () => {
    const s = mount(fixture());
    select(s, { layers: ["card"] });
    expect(input("Name").value).toBe("Card");
    const titles = [...container.querySelectorAll(".sb-insp-section__toggle")].map((el) => el.textContent);
    expect(titles).toEqual(["Basics", "Fill", "Stroke", "Shadow", "Layout", "Transform", "Filters and Blending", "Interaction"]);
    const opacity = input("Opacity");
    act(() => opacity.focus());
    type(opacity, "75");
    key(opacity, "Enter");
    expect(findLayer(main(s).layers, "card")!.layer.props.opacity).toBe(0.75);
    expect(s.document.getState().undoLabel).toBe("You: Set Opacity on Card");
  });

  it("coalesces a scrub into a single undo entry", () => {
    const s = mount(fixture());
    select(s, { layers: ["card"] });
    const field = input("Rotation").closest(".sb-scrub")!;
    const fire = (type: string, clientX: number) =>
      act(() => {
        field.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 0, pointerId: 7, button: 0 }));
      });
    fire("pointerdown", 100);
    for (const x of [106, 112, 118, 124, 130]) fire("pointermove", x);
    fire("pointerup", 130);
    const rotation = findLayer(main(s).layers, "card")!.layer.props.rotation;
    expect(typeof rotation).toBe("number");
    expect(rotation).not.toBe(0);
    expect(s.document.getState().historyEntries()).toHaveLength(1);
    expect(s.document.getState().undoLabel).toContain("Set Rotation on Card");
  });

  it("keeps a slow scrub as one undo step until the drag ends, then starts a new one", () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const s = mount(fixture());
    select(s, { layers: ["card"] });
    const field = input("Opacity").closest(".sb-scrub")!;
    const fire = (type: string, clientX: number) =>
      act(() => {
        field.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 0, pointerId: 3, button: 0 }));
      });
    const scrub = (start: number) => {
      fire("pointerdown", start);
      for (const dx of [8, 16, 24, 32]) {
        now += 1500;
        fire("pointermove", start - dx);
      }
      now += 4000;
      fire("pointerup", start - 32);
    };
    scrub(200);
    expect(s.document.getState().historyEntries().map((e) => e.label)).toEqual(["Set Opacity on Card"]);
    const afterFirst = findLayer(main(s).layers, "card")!.layer.props.opacity;
    expect(afterFirst).not.toBe(0.5);
    scrub(200);
    expect(s.document.getState().historyEntries()).toHaveLength(2);
    act(() => void s.document.getState().undo());
    expect(findLayer(main(s).layers, "card")!.layer.props.opacity).toBe(afterFirst);
  });

  it("shows a binding chip for linked properties that reveals and disconnects", () => {
    const s = mount(fixture());
    select(s, { layers: ["card"] });
    const chip = [...container.querySelectorAll(".sb-insp-chip")].find((el) => el.textContent?.includes("← grow.output"))!;
    expect(chip).toBeTruthy();
    click(chip);
    expect(s.selection.getState().reveal).toMatchObject({ component: "main", ids: ["grow"] });
    click(button("Disconnect Scale"));
    expect(findLayer(main(s).layers, "card")!.layer.props.scale).toBeUndefined();
  });

  it("edits Repeat in Basics under Enabled: Auto until a count is typed, copies from a linked loop", () => {
    const s = mount(
      build([
        { op: "addLayer", layer: { id: "card", type: "group", name: "Card" } },
        { op: "addPatch", patch: { id: "names", type: "loopBuilder", typeParam: "text", inputCount: 4, ui: { x: 0, y: 0 } } },
      ]),
    );
    select(s, { layers: ["card"] });
    const names = [...container.querySelectorAll(".sb-insp-row__name")].map((el) => el.textContent);
    expect(names.slice(names.indexOf("Enabled"), names.indexOf("Enabled") + 2)).toEqual(["Enabled", "Repeat"]);
    const repeat = input("Repeat");
    expect(repeat.value).toBe("");
    expect(repeat.placeholder).toBe("Auto");
    act(() => repeat.focus());
    type(repeat, "4");
    key(repeat, "Enter");
    expect(findLayer(main(s).layers, "card")!.layer.props.repeat).toBe(4);
    expect(s.document.getState().undoLabel).toBe("You: Set Repeat on Card");
    act(() => void s.document.getState().apply([{ op: "setInput", target: "@card.repeat", value: { link: "names.loop" } }], { label: "Link" }));
    const chip = [...container.querySelectorAll(".sb-insp-chip")].find((el) => el.textContent?.includes("← names.loop"));
    expect(chip).toBeTruthy();
    act(() => void s.runtime.stepFrame());
    expect(s.runtime.readValue("@card.repeat")).toBe(4);
  });

  it("drives a layer property with a patch from its port and its context menu", () => {
    layoutStore.getState().setViewMode("canvas");
    const s = mount(fixture());
    select(s, { layers: ["dot"] });
    click(button("Drive Opacity with a patch"));
    expect(patchEditorBridge(s).getState().targets.main).toEqual(["@dot.opacity"]);
    expect(patchEditorBridge(s).getState().request).toMatchObject({ kind: "drive", component: "main", address: "@dot.opacity" });
    expect(layoutStore.getState().viewMode).toBe("split");

    select(s, { layers: ["card"] });
    expect(button("Change what drives Scale")).not.toBeNull();
    act(() => {
      rowNamed("Opacity").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    });
    click(menuItem("Drive with a Patch…"));
    expect(patchEditorBridge(s).getState().request?.address).toBe("@card.opacity");

    select(s, { layers: ["card", "dot"] });
    expect(rowNamed("Opacity").hasAttribute("data-port")).toBe(true);
    expect(rowNamed("Opacity").querySelector(".sb-insp-port")).toBeNull();
    expect(rowNamed("Opacity").hasAttribute("data-sb-layer-prop")).toBe(false);
  });

  it("lights up rows a dragged cable can drive and accepts the drop", () => {
    const s = mount(fixture());
    select(s, { layers: ["dot"] });
    expect(rowNamed("Opacity").getAttribute("data-sb-layer-prop")).toBe("dot.opacity");
    expect(rowNamed("Opacity").hasAttribute("data-drop")).toBe(false);

    act(() => patchEditorBridge(s).getState().setCableDrag({ component: "main", from: "pop.output", type: "number" }));
    expect(rowNamed("Opacity").getAttribute("data-drop")).toBe("accept");
    expect(container.querySelector('.sb-insp-row[data-drop="reject"]')).not.toBeNull();

    act(() => {
      rowNamed("Opacity").querySelector("input")!.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 4, clientY: 4 }));
    });
    expect(rowNamed("Opacity").querySelector(".sb-insp-row__drop-hint")?.textContent).toBe("Drive Opacity from Pop Animation");

    expect(dropTargetAt(rowNamed("Opacity").querySelector("input"))).toEqual({ kind: "prop", target: { layerId: "dot", prop: "opacity" } });
    act(() => {
      completeConnectionToLayerProp("pop.output", { layerId: "dot", prop: "opacity" }, { session: s });
      patchEditorBridge(s).getState().setCableDrag(null);
    });
    expect(findLayer(main(s).layers, "dot")!.layer.props.opacity).toEqual({ link: "pop.output" });
    expect(container.querySelector("[data-drop]")).toBeNull();
    expect(rowNamed("Opacity").textContent).toContain("← pop.output");
  });

  it("imports a file from the asset picker", async () => {
    const s = mount(fixture());
    const imported = stubAssets(s);
    select(s, { layers: ["hero"] });
    expect(container.textContent).toContain("Import an image…");
    const opened = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    click(container.querySelector('button[aria-label^="Image: "]'));
    click(option("Import File…"));
    expect(opened).toHaveBeenCalledTimes(1);

    const picker = container.querySelector<HTMLInputElement>('input[type="file"][aria-label="Import a file for Image"]')!;
    expect(picker.accept).toContain("image/*");
    Object.defineProperty(picker, "files", { configurable: true, value: [png(1, "Hero Shot.png")] });
    await act(async () => {
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await eventually(() => expect(findLayer(main(s).layers, "hero")!.layer.props.image).toMatchObject({ asset: expect.any(String) }));
    const image = findLayer(main(s).layers, "hero")!.layer.props.image as { asset: string };
    expect(s.document.getState().doc.assets[image.asset]).toMatchObject({ kind: "image", name: "Hero Shot", width: 64, height: 48 });
    expect(imported).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".sb-insp-dropzone")).toBeNull();
    // Importing and setting the property are one undo step.
    expect(s.document.getState().historyEntries().map((e) => e.label)).toEqual(["Set Image on Hero"]);
    act(() => s.document.getState().undo());
    expect(findLayer(main(s).layers, "hero")!.layer.props.image).toBeUndefined();
    expect(s.document.getState().doc.assets[image.asset]).toBeUndefined();
  });

  it("imports files dropped on an asset row or anywhere on a media layer's inspector, and refuses the wrong kind", async () => {
    const s = mount(fixture());
    const imported = stubAssets(s);
    select(s, { layers: ["hero"] });
    const row = rowNamed("Image");

    act(() => {
      row.dispatchEvent(dragEvent("dragover", fileTransfer([png(2, "sky.png")])));
    });
    expect(row.getAttribute("data-drop-hover")).toBe("true");
    expect(row.querySelector(".sb-insp-row__drop-hint")?.textContent).toBe("Drop to set Image");

    const clip = new File([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])], "clip.mp4", { type: "video/mp4" });
    await act(async () => {
      row.dispatchEvent(dragEvent("drop", fileTransfer([clip])));
    });
    expect(imported).not.toHaveBeenCalled();
    expect(findLayer(main(s).layers, "hero")!.layer.props.image).toBeUndefined();

    await act(async () => {
      row.dispatchEvent(dragEvent("drop", fileTransfer([png(2, "sky.png")])));
    });
    await eventually(() => expect(findLayer(main(s).layers, "hero")!.layer.props.image).toMatchObject({ asset: "sky" }));

    const header = container.querySelector(".sb-insp-header")!;
    act(() => {
      header.dispatchEvent(dragEvent("dragover", fileTransfer([png(3, "night.png")])));
    });
    expect(container.querySelector(".sb-insp-layer")!.getAttribute("data-file-drop")).toBe("true");
    expect(container.querySelector(".sb-insp-filedrop")?.textContent).toContain("Drop to set Image on Hero");
    await act(async () => {
      header.dispatchEvent(dragEvent("drop", fileTransfer([png(3, "night.png")])));
    });
    await eventually(() => expect(findLayer(main(s).layers, "hero")!.layer.props.image).toMatchObject({ asset: "night" }));
    expect(container.querySelector(".sb-insp-layer")!.hasAttribute("data-file-drop")).toBe(false);
  });

  it("shows mixed values for a multi-selection and edits every layer", () => {
    const s = mount(fixture());
    select(s, { layers: ["card", "dot"] });
    expect(input("Name")).toBeNull();
    expect(container.textContent).toContain("2 layers");
    const opacity = input("Opacity");
    expect(opacity.getAttribute("aria-valuetext")).toBe("Mixed");
    act(() => opacity.focus());
    type(opacity, "100");
    key(opacity, "Enter");
    expect(findLayer(main(s).layers, "card")!.layer.props.opacity).toBe(1);
    expect(findLayer(main(s).layers, "dot")!.layer.props.opacity).toBe(1);
  });

  it("reveals advanced properties behind More", () => {
    const s = mount(fixture());
    select(s, { layers: ["card"] });
    expect(input("Z Position")).toBeNull();
    const transform = [...container.querySelectorAll("section")].find((el) => el.getAttribute("aria-label") === "Transform")!;
    click(buttonWithText("More (4)", transform));
    expect(input("Z Position")).not.toBeNull();
  });

  it("describes a patch with docs, type, linked inputs, and variadic count", () => {
    const s = mount(fixture());
    select(s, { patches: ["grow"] });
    expect(input("Name").placeholder).toBe("Transition");
    expect(container.textContent).toContain(getPatchSpec(registry, "transition")!.summary);
    expect(button("Value type: Number")).not.toBeNull();
    expect(container.textContent).toContain("← pop.output");
    click(buttonWithText("Learn More"));
    expect(container.querySelector(".sb-insp-docs")).not.toBeNull();

    select(s, { patches: ["sum"] });
    click(button("Add a value"));
    expect(main(s).patches.sum!.inputCount).toBe(3);
    expect(input("Value 3")).not.toBeNull();
  });

  it("asks before a Type change disconnects cables, and inserts a converter in the same undo step", () => {
    const s = mount(fixture());
    select(s, { patches: ["grow"] });
    click(button("Value type: Number"));
    click(option("Color"));
    const card = container.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(card.textContent).toContain("Switching to Color disconnects a cable");
    expect(card.textContent).toContain("Card · Scale");
    expect(card.textContent).toContain("values you set go back to their defaults");
    expect(main(s).patches.grow!.typeParam).toBe("number");
    expect(s.document.getState().historyEntries()).toHaveLength(0);

    click([...card.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Insert ")));
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(main(s).patches.grow!.typeParam).toBe("color");
    const scale = findLayer(main(s).layers, "card")!.layer.props.scale as { link: string };
    const converter = scale.link.split(".")[0]!;
    expect(converter).not.toBe("grow");
    expect(Object.values(main(s).patches[converter]!.inputs)).toContainEqual({ link: "grow.output" });
    expect(s.document.getState().historyEntries()).toHaveLength(1);
    expect(s.document.getState().undoLabel).toContain("and insert");

    act(() => void s.document.getState().undo());
    expect(main(s).patches.grow!.typeParam).toBe("number");
    expect(findLayer(main(s).layers, "card")!.layer.props.scale).toEqual({ link: "grow.output" });
    expect(main(s).patches[converter]).toBeUndefined();
  });

  it("cancels or disconnects when asked instead", () => {
    const s = mount(fixture());
    select(s, { patches: ["grow"] });
    click(button("Value type: Number"));
    click(option("Color"));
    click(buttonWithText("Cancel", container.querySelector('[role="alertdialog"]')!));
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(main(s).patches.grow!.typeParam).toBe("number");

    click(button("Value type: Number"));
    click(option("Color"));
    click(buttonWithText("Change Anyway", container.querySelector('[role="alertdialog"]')!));
    expect(main(s).patches.grow!.typeParam).toBe("color");
    expect(findLayer(main(s).layers, "card")!.layer.props.scale).toBeUndefined();

    // Changes that don't disconnect anything apply right away.
    select(s, { patches: ["pop"] });
    click(button("Value type: Number"));
    click(option("Point"));
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(main(s).patches.pop!.typeParam).toBe("point");
  });

  it("asks before removing an input that has a cable", () => {
    let doc = build([{ op: "updatePatch", component: "main", id: "sum", inputCount: 3 }], fixture());
    const last = resolveNodePorts(doc, doc.components.main!.patches.sum!, registry)!.inputs.at(-1)!;
    doc = build([{ op: "connect", from: "pop.output", to: `sum.${last.key}` }], doc);
    const s = mount(doc);
    select(s, { patches: ["sum"] });
    click(button("Remove a value"));
    const card = container.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(card.textContent).toContain("Removing Value 3 disconnects a cable");
    expect(card.textContent).toContain("That port goes away.");
    click(buttonWithText("Remove Anyway", card));
    expect(main(s).patches.sum!.inputCount).toBe(2);
  });

  it("sends Learn More to the host when asked", () => {
    const onLearnMore = vi.fn();
    const s = mount(fixture(), { onLearnMore });
    select(s, { patches: ["pop"] });
    click(buttonWithText("Learn More"));
    expect(onLearnMore).toHaveBeenCalledWith("popAnimation");
  });

  it("applies spring presets, draws the curve, and offers handoff code", () => {
    const s = mount(fixture());
    select(s, { patches: ["pop"] });
    const presets = container.querySelector('[role="radiogroup"][aria-label="Spring feel"]')!;
    expect([...presets.querySelectorAll('[role="radio"]')].map((el) => el.textContent)).toEqual(["Smooth", "Snappy", "Bouncy", "Gentle"]);
    click(buttonWithText("Bouncy", presets));
    const pop = main(s).patches.pop!;
    expect(activePreset(pop, getPatchSpec(registry, "popAnimation")!)).toBe("bouncy");
    expect(presets.querySelector('[aria-checked="true"]')?.textContent).toBe("Bouncy");
    expect(s.document.getState().undoLabel).toContain("Apply Bouncy spring");
    expect(container.querySelector(".sb-spring__curve")?.getAttribute("d")).toMatch(/^M/);
    expect(container.querySelector(".sb-insp-code__pre")?.textContent).toContain(".spring(duration:");
    click([...container.querySelectorAll('[role="tab"]')].find((el) => el.textContent === "CSS"));
    expect(container.querySelector(".sb-insp-code__pre")?.textContent).toContain("linear(");
  });

  it("toggles bypass and renames a patch", () => {
    const s = mount(fixture());
    select(s, { patches: ["grow"] });
    click(container.querySelector('button[aria-label="Bypass"]'));
    expect(main(s).patches.grow!.muted).toBe(true);
    const name = input("Name");
    act(() => name.focus());
    type(name, "Card Scale");
    key(name, "Enter");
    act(() => name.blur());
    expect(main(s).patches.grow!.name).toBe("Card Scale");
  });

  it("lets you choose between layers and patches when both are selected", () => {
    const s = mount(fixture());
    select(s, { layers: ["card"], patches: ["pop"] });
    expect(input("Name").value).toBe("Card");
    click(container.querySelector('[role="radio"][aria-checked="false"]'));
    expect(input("Name").placeholder).toBe("Pop Animation");
  });
});

describe("InspectorPanel: variables and published ports", () => {
  const variables = () =>
    build([
      { op: "addPatch", patch: { id: "liked", type: "variableBroadcaster", typeParam: "boolean", settings: { name: "isLiked" }, ui: { x: 0, y: 0 } } },
      { op: "addPatch", patch: { id: "count", type: "variableBroadcaster", settings: { name: "count", scope: "global" }, ui: { x: 0, y: 200 } } },
      { op: "addPatch", patch: { id: "reader", type: "variableReceiver", ui: { x: 300, y: 0 } } },
    ]);

  it("names a broadcaster's variable from its header, with no second Name field", () => {
    const s = mount(variables());
    select(s, { patches: ["liked"] });
    expect(rowNamed("Name")).toBeUndefined();
    expect(rowNamed("Scope")).toBeDefined();
    const name = input("Name");
    expect(name.value).toBe("isLiked");
    act(() => name.focus());
    type(name, "hearted");
    key(name, "Enter");
    act(() => name.blur());
    expect(main(s).patches.liked!.settings).toEqual({ name: "hearted" });
    expect(main(s).patches.liked!.name).toBeUndefined();
  });

  it("lets a receiver pick from the variables it can read, copying name, scope, and type in one step", () => {
    const s = mount(variables());
    select(s, { patches: ["reader"] });
    expect(rowNamed("Name")).toBeUndefined();
    expect(rowNamed("Scope")).toBeUndefined();
    expect(container.querySelector('input[aria-label="Name"]')).toBeNull();
    expect(container.textContent).toContain("Choose the variable this receiver reads.");
    click(container.querySelector('button.sb-select[aria-label^="Variable"]'));
    expect([...document.querySelectorAll('[role="option"] .sb-selectmenu__label')].map((el) => el.textContent)).toEqual(["isLiked", "count"]);
    click(option("isLiked"));
    expect(main(s).patches.reader).toMatchObject({ typeParam: "boolean", settings: { name: "isLiked" } });
    expect(s.document.getState().undoLabel).toBe("You: Read variable “isLiked” in Variable Receiver");
    expect(container.textContent).not.toContain("Choose the variable this receiver reads.");
    expect(button("Jump to broadcaster").disabled).toBe(false);
    click(button("Jump to broadcaster"));
    expect(s.selection.getState().patches).toEqual(["liked"]);
  });

  it("lists a component's published ports to rename and unpublish, and says how to publish more", () => {
    const doc = build([
      { op: "addComponent", component: { id: "press", name: "Press", kind: "patchComponent" } },
      { op: "addPatch", component: "press", patch: { id: "spring", type: "popAnimation", ui: { x: 0, y: 0 } } },
      { op: "updateInterface", component: "press", inputs: { bounciness: { key: "bounciness", name: "Bounciness", type: "number", default: 5 } } },
      { op: "connect", component: "press", from: "$in.bounciness", to: "spring.bounciness" },
      { op: "addPatch", patch: { id: "press_1", type: "component", component: "press", ui: { x: 0, y: 0 } } },
    ]);
    const s = mount(doc);
    act(() => s.selection.getState().enterComponent("press"));
    const press = () => s.document.getState().doc.components.press!;
    expect(container.textContent).toContain("Published inputs");
    expect(container.textContent).toContain("Point at an output and press ⌥P");
    expect(container.querySelector(".sb-insp-interface__default")).not.toBeNull();
    const name = input("Published input name");
    expect(name.value).toBe("Bounciness");
    act(() => name.focus());
    type(name, "Bounce");
    key(name, "Enter");
    expect(press().interface.inputs.bounciness!.name).toBe("Bounce");
    click(button("Unpublish Bounce"));
    expect(press().interface.inputs.bounciness).toBeUndefined();
    expect(press().patches.spring!.inputs.bounciness).toBe(5);
    expect(container.textContent).toContain("None yet. In the patch editor, point at an input and press ⌥P");
  });
});

