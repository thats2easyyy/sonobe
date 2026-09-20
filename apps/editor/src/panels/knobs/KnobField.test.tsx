// @vitest-environment happy-dom
import { applyOps, createEmptyDocument, findLayer, type Op, type SonobeDocument } from "@sonobe/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { layoutStore } from "../../shell/layoutStore.ts";
import { EditorProvider } from "../../state/EditorProvider.tsx";
import { getRegistry } from "../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { InspectorPanel } from "../inspector/InspectorPanel.tsx";

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
  layoutStore.getState().reset();
});

function build(ops: Op[], doc: SonobeDocument = createEmptyDocument()): SonobeDocument {
  const result = applyOps(doc, ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

const fixture = (extra: Op[] = []) =>
  build([
    { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card", props: { opacity: 0.5 } } },
    { op: "addLayer", layer: { id: "dot", type: "oval", name: "Dot", props: { opacity: 0.8 } } },
    { op: "addPatch", patch: { id: "pop", type: "popAnimation", typeParam: "number", ui: { x: 0, y: 200 } } },
    ...extra,
  ]);

function mount(doc: SonobeDocument): EditorSession {
  session = createEditorSession({ host: null, registry, document: doc, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  const s = session;
  act(() =>
    root.render(
      <EditorProvider session={s} commands={false} clipboardEvents={false} rpc={false}>
        <InspectorPanel />
      </EditorProvider>,
    ),
  );
  return s;
}

const main = (s: EditorSession) => s.document.getState().doc.components.main!;
const prop = (s: EditorSession, layer: string, key: string) => findLayer(main(s).layers, layer)!.layer.props[key];
const labels = (s: EditorSession) => s.document.getState().historyEntries().map((e) => e.label);
const rowNamed = (name: string) => [...container.querySelectorAll<HTMLElement>(".sb-insp-row")].find((row) => row.querySelector(".sb-insp-row__name")?.textContent === name)!;
const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.querySelector(".sb-menu__title")?.textContent === label)!;
const buttonWithText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;
const select = (s: EditorSession, items: { layers?: string[]; patches?: string[] }) => act(() => s.selection.getState().select(items));

function click(el: Element | null | undefined) {
  act(() => {
    (el as HTMLElement).click();
  });
}

function openMenu(row: HTMLElement) {
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
  });
}

function type(el: HTMLInputElement, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(el: Element, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("knobs in Properties", () => {
  it("makes a knob from a field in one step, linking every selected layer and storing the inferred range", () => {
    const s = mount(fixture());
    select(s, { layers: ["card", "dot"] });
    openMenu(rowNamed("Opacity"));
    click(menuItem("Make Knob…"));
    const name = document.querySelector<HTMLInputElement>('input[aria-label="Knob name"]')!;
    expect(name.value).toBe("Opacity");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Min"]')!.value).toBe("0");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Max"]')!.value).toBe("1");
    type(name, "Card Fade");
    type(document.querySelector<HTMLInputElement>('input[aria-label="Knob group"]')!, "Look");
    click(buttonWithText("Make Knob"));

    const knobs = s.document.getState().doc.knobs!;
    expect(knobs.knobs).toEqual([{ id: "card_fade", name: "Card Fade", group: "Look", type: "number", values: { default: 0.5 }, min: 0, max: 1, step: 0.01 }]);
    expect(prop(s, "card", "opacity")).toEqual({ link: "$knob.card_fade" });
    expect(prop(s, "dot", "opacity")).toEqual({ link: "$knob.card_fade" });
    expect(labels(s)).toEqual(["Make Knob “Card Fade”"]);
    s.document.getState().undo();
    expect(s.document.getState().doc.knobs).toBeUndefined();
    expect(prop(s, "card", "opacity")).toBe(0.5);
  });

  it("shows a knob-driven field as the knob: tuning it changes the knob, and Unlink keeps the running value", () => {
    const s = mount(fixture([{ op: "addKnob", knob: { id: "fade", name: "Fade", type: "number", value: 0.5, min: 0, max: 1, step: 0.01 } }, { op: "setInput", target: "@card.opacity", value: { link: "$knob.fade" } }, { op: "setInput", target: "@dot.opacity", value: { link: "$knob.fade" } }]));
    select(s, { layers: ["card"] });
    const row = rowNamed("Opacity");
    expect(row.querySelector(".sb-insp-knob__chip")!.textContent).toBe("Fade");
    expect(row.querySelector(".sb-insp-knob__meta")!.textContent).toBe("Knob · 2 uses");
    const field = row.querySelector<HTMLInputElement>('input[aria-label="Opacity value"]')!;
    act(() => field.focus());
    type(field, "0.7");
    press(field, "Enter");
    expect(s.document.getState().doc.knobs!.knobs[0]!.values).toEqual({ default: 0.7 });
    expect(prop(s, "card", "opacity")).toEqual({ link: "$knob.fade" });
    expect(labels(s)[0]).toBe("Tune Fade to 0.7 (Default)");

    click(row.querySelector('button[aria-label="Unlink Opacity from Fade"]'));
    expect(prop(s, "card", "opacity")).toBe(0.7);
    expect(prop(s, "dot", "opacity")).toEqual({ link: "$knob.fade" });
    expect(labels(s)[0]).toBe("Unlink Opacity from Fade");
  });

  it("connects a field to a knob that fits it with Use Knob", () => {
    const s = mount(fixture([{ op: "addKnob", knob: { id: "bounce", name: "Bounce", type: "number", value: 9 } }, { op: "addKnob", knob: { id: "tint", name: "Tint", type: "color", value: "#FF3B30FF" } }]));
    select(s, { patches: ["pop"] });
    openMenu(rowNamed("Bounciness"));
    click(menuItem("Use Knob"));
    // A color can't drive a number, so that knob isn't offered.
    expect(menuItem("Tint")).toBeUndefined();
    click(menuItem("Bounce"));
    expect(main(s).patches.pop!.inputs.bounciness).toEqual({ link: "$knob.bounce" });
    expect(rowNamed("Bounciness").querySelector(".sb-insp-knob__chip")!.textContent).toBe("Bounce");
  });

  it("switches a knob-driven field to another knob with Use Knob, in one undo step", () => {
    const s = mount(
      fixture([
        { op: "addKnob", knob: { id: "fade", name: "Fade", type: "number", value: 0.5 } },
        { op: "addKnob", knob: { id: "dim", name: "Dim", type: "number", value: 0.2 } },
        { op: "setInput", target: "@card.opacity", value: { link: "$knob.fade" } },
        { op: "setInput", target: "@dot.opacity", value: { link: "$knob.fade" } },
      ]),
    );
    select(s, { layers: ["card", "dot"] });
    openMenu(rowNamed("Opacity"));
    click(menuItem("Use Knob"));
    // The knob it reads is checked.
    const choice = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find((el) => el.querySelector(".sb-menu__title")?.textContent === label)!;
    expect(choice("Fade").getAttribute("aria-checked")).toBe("true");
    expect(choice("Dim").getAttribute("aria-checked")).toBe("false");
    click(choice("Dim"));
    expect(prop(s, "card", "opacity")).toEqual({ link: "$knob.dim" });
    expect(prop(s, "dot", "opacity")).toEqual({ link: "$knob.dim" });
    expect(labels(s)).toEqual(["Switch Opacity to Dim"]);
    s.document.getState().undo();
    expect(prop(s, "card", "opacity")).toEqual({ link: "$knob.fade" });
    expect(prop(s, "dot", "opacity")).toEqual({ link: "$knob.fade" });
  });

  it("puts targets that read different knobs on one knob", () => {
    const s = mount(
      fixture([
        { op: "addKnob", knob: { id: "fade", name: "Fade", type: "number", value: 0.5 } },
        { op: "addKnob", knob: { id: "dim", name: "Dim", type: "number", value: 0.2 } },
        { op: "setInput", target: "@card.opacity", value: { link: "$knob.fade" } },
        { op: "setInput", target: "@dot.opacity", value: { link: "$knob.dim" } },
      ]),
    );
    select(s, { layers: ["card", "dot"] });
    openMenu(rowNamed("Opacity"));
    expect(menuItem("Make Knob…")).toBeUndefined();
    click(menuItem("Use Knob"));
    click(menuItem("Dim"));
    expect(prop(s, "card", "opacity")).toEqual({ link: "$knob.dim" });
    expect(labels(s)).toEqual(["Switch Opacity to Dim"]);
  });

  it("names the knob in the port's tooltip", () => {
    vi.useFakeTimers();
    try {
      const s = mount(fixture([{ op: "addKnob", knob: { id: "fade", name: "Card Fade", type: "number", value: 0.5 } }, { op: "setInput", target: "@card.opacity", value: { link: "$knob.fade" } }]));
      select(s, { layers: ["card"] });
      const port = rowNamed("Opacity").querySelector<HTMLElement>(".sb-insp-port")!;
      act(() => {
        port.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
      });
      act(() => vi.advanceTimersByTime(600));
      expect(document.querySelector('[role="tooltip"]')!.textContent).toBe("Driven by the knob Card Fade. Click to drive it with a patch instead.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads a locked preset's knob field without changing it", () => {
    const s = mount(fixture([{ op: "addKnob", knob: { id: "fade", name: "Fade", type: "number", value: 0.5 } }, { op: "updateKnobPreset", id: "default", locked: true }, { op: "setInput", target: "@card.opacity", value: { link: "$knob.fade" } }]));
    select(s, { layers: ["card"] });
    const row = rowNamed("Opacity");
    expect(row.querySelector(".sb-insp-knob__meta")!.textContent).toContain("Default is locked");
    expect(row.querySelector<HTMLInputElement>('input[aria-label="Opacity"]')!.disabled).toBe(true);
  });
});
