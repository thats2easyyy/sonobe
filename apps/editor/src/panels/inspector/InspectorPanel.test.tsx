// @vitest-environment happy-dom
import { applyOps, createEmptyDocument, findLayer, getPatchSpec, type Op, type SonobeDocument } from "@sonobe/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { EditorProvider } from "../../state/EditorProvider.tsx";
import { getRegistry } from "../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
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
});

function build(ops: Op[]): SonobeDocument {
  const result = applyOps(createEmptyDocument(), ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

const fixture = () =>
  build([
    { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card", props: { position: [16, 146], size: [370, 440], opacity: 0.5 } } },
    { op: "addLayer", layer: { id: "dot", type: "oval", name: "Dot", props: { opacity: 0.8 } } },
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

describe("InspectorPanel", () => {
  it("shows a friendly empty state with the component's notes", () => {
    const s = mount(fixture());
    expect(container.textContent).toContain("Nothing selected");
    expect(container.textContent).toContain("2 layers · 3 patches");
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
    expect(main(s).layers.map((l) => l.props.opacity)).toEqual([1, 1]);
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
