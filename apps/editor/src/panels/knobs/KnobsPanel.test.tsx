// @vitest-environment happy-dom
import { applyOps, createEmptyDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { layoutStore } from "../../shell/layoutStore.ts";
import { EditorProvider } from "../../state/EditorProvider.tsx";
import { getRegistry } from "../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { InspectorPanel } from "../inspector/InspectorPanel.tsx";
import { knobsUi } from "./knobsStore.ts";

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
  layoutStore.getState().setInspectorTab("knobs");
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

/** A card thrown by a spring: two presets, four knobs in two groups (and one ungrouped), three readers. */
const deck = (extra: Op[] = []) =>
  build([
    { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card", props: { size: [300, 200] } } },
    { op: "addPatch", patch: { id: "spring", type: "popAnimation", typeParam: "number", ui: { x: 0, y: 0 } } },
    { op: "addKnobPreset", preset: { id: "proposal", name: "Proposal" } },
    { op: "addKnobPreset", preset: { id: "shipped", name: "Shipped app" } },
    { op: "addKnob", knob: { id: "radius", name: "Card Radius", type: "number", value: 12, min: 0, max: 40, step: 1, unit: "pt" } },
    { op: "addKnob", knob: { id: "commit", name: "Commit Distance", type: "number", group: "Throw", value: 95, min: 0, max: 200, step: 1, unit: "pt" } },
    { op: "addKnob", knob: { id: "tilt", name: "Grab Tilt", type: "boolean", group: "Tilt", values: { proposal: true, shipped: false } } },
    { op: "addKnob", knob: { id: "bounce", name: "Bounce", type: "number", group: "Throw", values: { proposal: 8, shipped: 5 }, min: 0, max: 20, step: 0.5 } },
    { op: "setInput", target: "spring.bounciness", value: { link: "$knob.bounce" } },
    { op: "setInput", target: "@card.cornerRadius", value: { link: "$knob.radius" } },
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

const knobs = (s: EditorSession) => s.document.getState().doc.knobs!;
const labels = (s: EditorSession) => s.document.getState().historyEntries().map((e) => e.label);
const rowOf = (name: string) => container.querySelector<HTMLElement>(`.sb-knob-row[aria-label="${name}"]`)!;
const chip = (name: string) => [...container.querySelectorAll<HTMLElement>('[role="radio"]')].find((el) => el.textContent?.includes(name))!;
const buttonWithText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;

function click(el: Element | null | undefined) {
  act(() => {
    (el as HTMLElement).click();
  });
}

function pointer(target: Element, kind: "pointerdown" | "pointermove" | "pointerup", clientX: number) {
  act(() => {
    target.dispatchEvent(new PointerEvent(kind, { bubbles: true, cancelable: true, clientX, clientY: 0, pointerId: 1, button: 0 }));
  });
}

describe("Knobs tab", () => {
  it("lists knobs without a group first, then groups in the order of their first knob", () => {
    mount(deck());
    const groups = [...container.querySelectorAll<HTMLElement>(".sb-knobs-group")].map((g) => [g.getAttribute("aria-label"), [...g.querySelectorAll(".sb-knob-row")].map((r) => r.getAttribute("aria-label"))]);
    expect(groups).toEqual([
      ["Knobs", ["Card Radius"]],
      ["Throw", ["Commit Distance", "Bounce"]],
      ["Tilt", ["Grab Tilt"]],
    ]);
    // Nothing reads Commit Distance yet, and Bounce differs from the partner preset.
    expect(rowOf("Commit Distance").dataset.unused).toBe("true");
    expect(rowOf("Bounce").querySelector(".sb-knob-row__diff")!.textContent).toBe("≠");
    expect(rowOf("Card Radius").querySelector(".sb-knob-row__diff")!.textContent).toBe("");
    expect(container.querySelector(".sb-knobs__filter-count")!.textContent).toContain("2 of 4 differ");
  });

  it("makes a slider drag one undo step, labeled with the value and the preset", () => {
    const s = mount(deck());
    const slider = rowOf("Card Radius").querySelector<HTMLElement>('[role="slider"]')!;
    vi.spyOn(slider.querySelector(".sb-slider__track")!, "getBoundingClientRect").mockReturnValue({ left: 0, width: 40, top: 0, height: 4, right: 40, bottom: 4, x: 0, y: 0, toJSON: () => ({}) });
    pointer(slider, "pointerdown", 20);
    pointer(slider, "pointermove", 25);
    pointer(slider, "pointermove", 30);
    pointer(slider, "pointerup", 30);
    expect(knobs(s).knobs.find((k) => k.id === "radius")!.values).toEqual({ proposal: 30, shipped: 12 });
    expect(labels(s)[0]).toBe("Tune Card Radius to 30 pt (Proposal)");
    expect(s.document.getState().historyEntries()).toHaveLength(1);
    expect(s.document.getState().gesture).toBeNull();
    s.document.getState().undo();
    expect(knobs(s).knobs.find((k) => k.id === "radius")!.values.proposal).toBe(12);
  });

  it("undoes a run of preset switches in one step, and another edit ends the run", () => {
    const s = mount(deck());
    click(chip("Shipped app"));
    click(chip("Proposal"));
    click(chip("Shipped app"));
    expect(knobs(s).active).toBe("shipped");
    expect(labels(s)).toEqual(["Switch Presets"]);
    s.document.getState().apply([{ op: "updateLayer", id: "card", props: { opacity: 0.5 } }], { label: "Fade Card" });
    click(chip("Proposal"));
    expect(labels(s)).toEqual(["Switch Presets", "Fade Card", "Switch Presets"]);
    s.document.getState().undo();
    s.document.getState().undo();
    s.document.getState().undo();
    expect(knobs(s).active).toBe("proposal");
  });

  it("filters to the knobs that differ, and a tick copies the other preset's value", () => {
    const s = mount(deck());
    const filter = [...container.querySelectorAll<HTMLElement>('[role="checkbox"]')].find((el) => el.closest(".sb-knobs__filter"))!;
    click(filter);
    expect([...container.querySelectorAll(".sb-knob-row")].map((r) => r.getAttribute("aria-label"))).toEqual(["Bounce", "Grab Tilt"]);
    const tick = rowOf("Bounce").querySelector<HTMLButtonElement>(".sb-slider__tick")!;
    expect(tick.getAttribute("aria-label")).toBe("Shipped app: 5");
    click(tick);
    expect(knobs(s).knobs.find((k) => k.id === "bounce")!.values).toEqual({ proposal: 5, shipped: 5 });
    expect(labels(s)[0]).toBe("Tune Bounce to 5 (Proposal)");
    expect([...container.querySelectorAll(".sb-knob-row")].map((r) => r.getAttribute("aria-label"))).toEqual(["Grab Tilt"]);
  });

  it("makes a locked preset's rows read-only, with a way to switch or unlock", () => {
    const s = mount(deck([{ op: "updateKnobPreset", id: "proposal", locked: true }]));
    expect(container.querySelector(".sb-knobs-locked")!.textContent).toContain("Proposal is locked");
    const slider = rowOf("Card Radius").querySelector<HTMLElement>('[role="slider"]')!;
    expect(slider.getAttribute("aria-disabled")).toBe("true");
    expect(rowOf("Grab Tilt").querySelector("fieldset")!.disabled).toBe(true);
    click(buttonWithText("Switch to Shipped app"));
    expect(knobs(s).active).toBe("shipped");
    expect(container.querySelector(".sb-knobs-locked")).toBeNull();
    click(chip("Proposal"));
    click(buttonWithText("Unlock"));
    expect(knobs(s).presets[0]).toEqual({ id: "proposal", name: "Proposal" });
  });

  it("offers Make Knob and, when broadcasters share constants, converting them", () => {
    const s = mount(
      build([
        { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } },
        { op: "addPatch", patch: { id: "radius_var", type: "variableBroadcaster", typeParam: "number", settings: { name: "Card Radius" }, inputs: { value: 16 }, ui: { x: 0, y: 0 } } },
        { op: "addPatch", patch: { id: "radius_in", type: "variableReceiver", typeParam: "number", settings: { name: "Card Radius" }, ui: { x: 200, y: 0 } } },
        { op: "connect", from: "radius_in.output", to: "@card.cornerRadius" },
      ]),
    );
    expect(container.querySelector(".sb-empty__title")!.textContent).toBe("No knobs yet");
    expect(container.querySelector(".sb-knobs__note")!.textContent).toContain("shares 1 constant through Variable Broadcasters");
    click(buttonWithText("Convert to Knobs"));
    expect(document.querySelector(".sb-knobs-convert")!.textContent).toContain("Card Radius");
    click(buttonWithText("Convert 1"));
    const doc = s.document.getState().doc;
    expect(doc.knobs!.knobs.map((k) => [k.id, k.values])).toEqual([["card_radius", { default: 16 }]]);
    expect(doc.components.main!.layers[0]!.props.cornerRadius).toEqual({ link: "$knob.card_radius" });
    expect(labels(s)[0]).toBe("Convert 1 Variable to Knobs");
  });

  it("adds a preset to compare as a running copy, in one undo step", () => {
    const s = mount(build([{ op: "addKnob", knob: { id: "gap", name: "Gap", type: "number", value: 8 } }]));
    click(buttonWithText("Add Preset to Compare"));
    expect(knobs(s)).toMatchObject({ active: "preset_2", presets: [{ id: "default", name: "Default" }, { id: "preset_2", name: "Preset 2" }] });
    expect(knobs(s).knobs[0]!.values).toEqual({ default: 8, preset_2: 8 });
    expect(labels(s)).toEqual(["New Preset “Preset 2”"]);
    s.document.getState().undo();
    expect(knobs(s).presets.map((p) => p.id)).toEqual(["default"]);
    expect(knobs(s).active).toBe("default");
  });

  it("stays on Knobs as the selection changes, with a way back to Properties", () => {
    const s = mount(deck());
    act(() => s.selection.getState().select({ patches: ["spring"] }));
    expect(container.querySelector(".sb-knobs__selection")!.textContent).toContain("1 patch selected");
    expect(container.querySelector(".sb-knobs")).not.toBeNull();
    click(buttonWithText("Show Properties"));
    expect(layoutStore.getState().inspectorTab).toBe("properties");
    expect(container.querySelector(".sb-knobs")).toBeNull();
  });

  it("moves between rows with ↑ and ↓, steps with ← and →, and types a value on Return", () => {
    const s = mount(deck());
    const key = (name: string, init: KeyboardEventInit = {}) =>
      act(() => {
        document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
      });
    act(() => rowOf("Card Radius").querySelector<HTMLElement>('[role="slider"]')!.focus());
    key("ArrowDown");
    expect(document.activeElement).toBe(rowOf("Commit Distance").querySelector('[role="slider"]'));
    key("ArrowRight", { shiftKey: true });
    expect(knobs(s).knobs.find((k) => k.id === "commit")!.values.proposal).toBe(105);
    key("ArrowUp");
    expect(document.activeElement).toBe(rowOf("Card Radius").querySelector('[role="slider"]'));
    key("Enter");
    expect(document.activeElement).toBe(rowOf("Card Radius").querySelector('input[aria-label="Card Radius value"]'));
  });

  it("flashes the row a patch editor chip or Show in Knobs asks for", () => {
    const s = mount(deck());
    act(() => knobsUi(s).getState().toggleGroup("Throw"));
    expect(rowOf("Bounce")).toBeNull();
    act(() => knobsUi(s).getState().set({ flash: { id: "bounce", at: 1 } }));
    expect(rowOf("Bounce").dataset.flash).toBe("true");
  });
});
