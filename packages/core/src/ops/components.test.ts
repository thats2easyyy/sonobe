import { describe, expect, it } from "vitest";
import { getDiagnostics } from "../diagnostics.ts";
import { buildSampleDocument, emptyDoc, expectRoundTrip, mockRegistry, mustApply } from "../testing/fixtures.ts";
import type { Op, SonobeDocument } from "../types.ts";
import { applyOps } from "./index.ts";

const apply = (doc: SonobeDocument, ops: Op[]) => applyOps(doc, ops, { registry: mockRegistry });
const firstError = (doc: SonobeDocument, ops: Op[]) => apply(doc, ops).errors[0]!;
const errorsOf = (doc: SonobeDocument) => getDiagnostics(doc, mockRegistry).filter((d) => d.severity === "error");

describe("addComponent / updateComponent / removeComponent", () => {
  it("adds components with derived ids and default sizes", () => {
    const doc = emptyDoc();
    const r = mustApply(doc, [
      { op: "addComponent", ref: "btn", component: { name: "Primary Button", kind: "layerComponent" } },
      { op: "addComponent", component: { name: "Primary Button", kind: "patchComponent" } },
      { op: "addComponent", component: { name: "Settings", kind: "prototype" } },
      { op: "addLayer", component: "$btn", layer: { type: "rectangle", name: "Bg" } },
    ]);
    expect(Object.keys(r.doc.components)).toEqual(["main", "primary_button", "primary_button_2", "settings"]);
    expect(r.doc.components.primary_button!.size).toEqual([200, 100]);
    expect(r.doc.components.primary_button_2!.size).toBeUndefined();
    expect(r.doc.components.settings!.size).toEqual([390, 844]);
    expect(r.doc.components.primary_button!.layers[0]!.id).toBe("bg");
    expect(r.idMap).toEqual({ btn: "primary_button" });
    expectRoundTrip(doc, r);
  });

  it("validates provided content", () => {
    const e = firstError(emptyDoc(), [{ op: "addComponent", component: { name: "X", kind: "patchComponent", patches: { p: { type: "switch", inputs: { flip: { lnk: "x" } } } } as never } }]);
    expect(e.code).toBe("invalid_value");
    expect(e.message).toContain("patches.p");
    expect(firstError(emptyDoc(), [{ op: "addComponent", component: { name: "X", kind: "widget" as "prototype" } }]).code).toBe("invalid_value");
    expect(firstError(emptyDoc(), [{ op: "addComponent", component: { id: "main", name: "X", kind: "prototype" } }]).code).toBe("id_taken");
    const dupes = firstError(emptyDoc(), [
      { op: "addComponent", component: { name: "X", kind: "layerComponent", layers: [{ id: "a", type: "rectangle", name: "A", props: {} }], patches: { a: { type: "switch", inputs: {}, ui: { x: 0, y: 0 } } } } },
    ]);
    expect(dupes).toMatchObject({ code: "id_taken", message: expect.stringContaining("a") });
  });

  it("updates name, notes and size", () => {
    const doc = emptyDoc();
    const r = mustApply(doc, [{ op: "updateComponent", id: "main", name: "Home", notes: "Tap to expand", size: [375, 667] }]);
    expect(r.doc.components.main).toMatchObject({ name: "Home", notes: "Tap to expand", size: [375, 667] });
    expectRoundTrip(doc, r);
    const patchOnly = mustApply(doc, [{ op: "addComponent", component: { name: "Logic", kind: "patchComponent" } }]).doc;
    expectRoundTrip(patchOnly, mustApply(patchOnly, [{ op: "updateComponent", id: "logic", size: [10, 10] }]));
    expect(firstError(doc, [{ op: "updateComponent", id: "main", size: [0, 10] }]).code).toBe("invalid_value");
  });

  it("merges, replaces and clears component metadata", () => {
    const doc = emptyDoc();
    const first = mustApply(doc, [{ op: "updateComponent", id: "main", meta: { patchEditor: { nodes: { card: [10, 20] } }, zoom: 1.5 } }]);
    expect(first.doc.components.main!.meta).toEqual({ patchEditor: { nodes: { card: [10, 20] } }, zoom: 1.5 });
    expect(first.inverse).toEqual([{ op: "updateComponent", id: "main", meta: null }]);
    expectRoundTrip(doc, first);

    const second = mustApply(first.doc, [{ op: "updateComponent", id: "main", meta: { zoom: null, grid: true, patchEditor: { nodes: {} } } }]);
    expect(second.doc.components.main!.meta).toEqual({ patchEditor: { nodes: {} }, grid: true });
    expect(second.inverse).toEqual([{ op: "updateComponent", id: "main", meta: { zoom: 1.5, grid: null, patchEditor: { nodes: { card: [10, 20] } } } }]);
    expectRoundTrip(first.doc, second);

    const cleared = mustApply(second.doc, [{ op: "updateComponent", id: "main", meta: null }]);
    expect(cleared.doc.components.main!.meta).toBeUndefined();
    expectRoundTrip(second.doc, cleared);

    const removedNothing = mustApply(doc, [{ op: "updateComponent", id: "main", meta: { gone: null } }]);
    expect(removedNothing.doc.components.main!.meta).toBeUndefined();
    expectRoundTrip(doc, removedNothing);

    expect(firstError(doc, [{ op: "updateComponent", id: "main", meta: [1] as never }]).code).toBe("invalid_value");
    expect(firstError(doc, [{ op: "updateComponent", id: "main", meta: { bad: Number.NaN } }])).toMatchObject({ code: "invalid_value", message: expect.stringContaining("meta.bad") });
  });

  it("refuses to remove the root or components still in use", () => {
    const doc = mustApply(emptyDoc(), [
      { op: "addComponent", component: { name: "Chip", kind: "layerComponent" } },
      { op: "addLayer", layer: { id: "chip_1", type: "componentInstance", component: "chip" } },
    ]).doc;
    expect(doc.components.main!.layers[0]!.name).toBe("Component");
    expect(firstError(doc, [{ op: "removeComponent", id: "main" }]).code).toBe("invalid_op");
    const e = firstError(doc, [{ op: "removeComponent", id: "chip" }]);
    expect(e.code).toBe("component_in_use");
    const fixed = mustApply(doc, e.suggestions![0]!.ops!);
    expect(fixed.doc.components.chip).toBeUndefined();
    expectRoundTrip(doc, fixed);
  });
});

describe("component instances", () => {
  const base = () =>
    mustApply(emptyDoc(), [
      { op: "addComponent", component: { name: "Card", kind: "layerComponent" } },
      { op: "addComponent", component: { name: "Logic", kind: "patchComponent" } },
    ]).doc;

  it("requires the right component kind and prevents cycles", () => {
    const doc = base();
    expect(firstError(doc, [{ op: "addLayer", layer: { type: "componentInstance", component: "logic" } }]).code).toBe("wrong_component_kind");
    expect(firstError(doc, [{ op: "addPatch", patch: { type: "component", component: "card" } }]).code).toBe("wrong_component_kind");
    expect(firstError(doc, [{ op: "addLayer", component: "card", layer: { type: "componentInstance", component: "card" } }]).code).toBe("component_cycle");
    const nested = mustApply(doc, [
      { op: "addComponent", component: { name: "Row", kind: "layerComponent" } },
      { op: "addLayer", component: "row", layer: { type: "componentInstance", component: "card" } },
    ]).doc;
    expect(firstError(nested, [{ op: "addLayer", component: "card", layer: { type: "componentInstance", component: "row" } }]).code).toBe("component_cycle");
    expect(firstError(doc, [{ op: "addLayer", layer: { type: "componentInstance" } }]).code).toBe("invalid_op");
    expect(firstError(doc, [{ op: "addLayer", layer: { type: "rectangle", component: "card" } }]).code).toBe("invalid_op");
    expect(firstError(doc, [{ op: "addPatch", patch: { type: "component", component: "lgoic" } }]).message).toContain('"logic"');
  });
});

describe("updateInterface", () => {
  const setup = () =>
    mustApply(emptyDoc(), [
      { op: "addComponent", component: { name: "Chip", kind: "layerComponent" } },
      { op: "updateInterface", component: "chip", inputs: { label: { key: "label", name: "Label", type: "text", default: "Hello" } } },
      { op: "addLayer", component: "chip", layer: { type: "text", name: "Title", props: { text: { link: "$in.label" } } } },
      { op: "addPatch", component: "chip", patch: { id: "tap", type: "interaction", inputs: { layer: { layer: "title" } } } },
      { op: "updateInterface", component: "chip", outputs: { tapped: { key: "tapped", name: "Tapped", type: "pulse", link: "tap.tap" } } },
      { op: "addLayer", layer: { id: "chip_1", type: "componentInstance", component: "chip", props: { label: "Buy" } } },
      { op: "addPatch", patch: { id: "toggle", type: "switch", inputs: { flip: { link: "@chip_1.tapped" } } } },
      { op: "addPatch", patch: { id: "count", type: "counter", inputs: { increase: { link: "@chip_1.tapped" } } } },
    ]).doc;

  it("publishes ports usable inside and on instances", () => {
    const doc = setup();
    expect(doc.components.chip!.interface.inputs.label).toStrictEqual({ key: "label", name: "Label", type: "text", default: "Hello" });
    expect(errorsOf(doc)).toEqual([]);
    expect(firstError(doc, [{ op: "setInput", target: "@chip_1.label", value: 3 }]).code).toBe("invalid_value");
    expect(firstError(doc, [{ op: "updateInterface", component: "chip", outputs: { bad: { key: "bad", name: "Bad", type: "number", link: "nope.output" } } }]).code).toBe("not_found");
    expect(firstError(doc, [{ op: "updateInterface", component: "chip", inputs: { x: { key: "x", name: "X", type: "vector" as "number" } } }]).message).toContain("unknown type");
    expect(firstError(doc, [{ op: "updateInterface", component: "chip", inputs: { y: { key: "y", name: "Y", type: "number", default: "big" } } }]).code).toBe("invalid_value");
    expect(firstError(doc, [{ op: "updateInterface", component: "chip", outputs: { t2: { key: "t2", name: "T2", type: "color", link: "tap.tap" } } }]).code).toBe("type_mismatch");
  });

  it("removing ports cascades inner links and instance values, and undo restores them", () => {
    const doc = setup();
    const r = mustApply(doc, [{ op: "updateInterface", component: "chip", inputs: { label: null }, outputs: { tapped: null } }]);
    expect(r.doc.components.chip!.layers[0]!.props).toEqual({});
    expect(r.doc.components.main!.layers[0]!.props).toEqual({});
    expect(r.doc.components.main!.patches.toggle!.inputs).toEqual({});
    expect(r.doc.components.main!.patches.count!.inputs).toEqual({});
    expect(errorsOf(r.doc)).toEqual([]);
    expectRoundTrip(doc, r);
  });

  it("supports patch component instances", () => {
    const doc = mustApply(emptyDoc(), [
      { op: "addComponent", ref: "logic", component: { name: "Logic", kind: "patchComponent" } },
      { op: "updateInterface", component: "$logic", inputs: { target: { key: "target", name: "Target", type: "number" } } },
      { op: "addPatch", component: "$logic", patch: { id: "spring", type: "popAnimation", inputs: { number: { link: "$in.target" } } } },
      { op: "updateInterface", component: "$logic", outputs: { value: { key: "value", name: "Value", type: "number", link: "spring.output" } } },
      { op: "addPatch", patch: { id: "toggle", type: "switch" } },
      { op: "addPatch", patch: { ref: "inst", type: "component", component: "$logic", inputs: { target: { link: "toggle.on" } } } },
      { op: "addLayer", layer: { type: "rectangle", name: "Card", props: { scale: { link: "$inst.value" } } } },
    ]).doc;
    expect(doc.components.main!.patches.component).toMatchObject({ type: "component", component: "logic", inputs: { target: { link: "toggle.on" } } });
    expect(errorsOf(doc)).toEqual([]);
    const r = mustApply(doc, [{ op: "updateInterface", component: "logic", outputs: { value: null } }]);
    expect(r.doc.components.main!.layers[0]!.props).toEqual({});
    expectRoundTrip(doc, r);
  });
});

describe("createComponent", () => {
  const buttonDoc = () =>
    mustApply(emptyDoc(), [
      { op: "addLayer", layer: { type: "rectangle", name: "Bg" } },
      { op: "addLayer", layer: { type: "group", name: "Button", props: { position: [20, 40], size: [100, 44] }, children: [{ type: "text", name: "Label", props: { text: "Buy" } }] } },
      { op: "addPatch", patch: { id: "tap", type: "interaction", inputs: { layer: { layer: "button" } } } },
      { op: "addPatch", patch: { id: "toggle", type: "switch", inputs: { flip: { link: "tap.tap" } } } },
      { op: "addPatch", patch: { id: "pop", type: "popAnimation", inputs: { number: { link: "toggle.on" } } } },
      { op: "setInput", target: "@button.scale", value: { link: "pop.output" } },
    ]).doc;

  it("refuses to strand interaction patches outside, suggesting to move them too", () => {
    const e = firstError(buttonDoc(), [{ op: "createComponent", name: "Primary Button", layerIds: ["button"] }]);
    expect(e.code).toBe("layer_ref_crosses_boundary");
    expect(e.suggestions![0]!.ops).toEqual([{ op: "createComponent", component: "main", name: "Primary Button", layerIds: ["button"], patchIds: ["tap"] }]);
  });

  it("moves layers and patches into a layer component wired equivalently", () => {
    const doc = buttonDoc();
    const r = mustApply(doc, [{ op: "createComponent", ref: "pb", name: "Primary Button", layerIds: ["button", "label"], patchIds: ["tap"] }]);
    const main = r.doc.components.main!;
    expect(r.idMap).toEqual({ pb: "primary_button" });
    expect(r.results[0]!.ids).toEqual(["primary_button", "primary_button"]);
    expect(r.doc.components.primary_button).toStrictEqual({
      formatVersion: 1,
      id: "primary_button",
      name: "Primary Button",
      kind: "layerComponent",
      size: [100, 44],
      interface: {
        inputs: { scale_2: { key: "scale_2", name: "Scale", type: "number" } },
        outputs: { tap: { key: "tap", name: "Tap", type: "pulse", link: "tap.tap" } },
      },
      layers: [
        {
          id: "button",
          type: "group",
          name: "Button",
          props: { position: [0, 0], size: [100, 44], scale: { link: "$in.scale_2" } },
          children: [{ id: "label", type: "text", name: "Label", props: { text: "Buy" } }],
        },
      ],
      patches: { tap: { type: "interaction", inputs: { layer: { layer: "button" } }, ui: { x: 40, y: 40 } } },
      comments: [],
    });
    expect(main.layers.map((l) => l.id)).toEqual(["bg", "primary_button"]);
    expect(main.layers[1]).toStrictEqual({
      id: "primary_button",
      type: "componentInstance",
      name: "Primary Button",
      component: "primary_button",
      props: { scale_2: { link: "pop.output" }, position: [20, 40], size: [100, 44] },
    });
    expect(main.patches.toggle!.inputs.flip).toEqual({ link: "@primary_button.tap" });
    expect(main.patches.tap).toBeUndefined();
    expect(getDiagnostics(r.doc, mockRegistry).filter((d) => d.severity !== "info")).toEqual([]);
    expect(r.affected.components).toEqual(["main", "primary_button"]);
    expectRoundTrip(doc, r);
  });

  it("turns patches into a patch component with a component patch instance", () => {
    const doc = buildSampleDocument();
    const r = mustApply(doc, [{ op: "createComponent", name: "Grow", patchIds: ["pop", "grow"] }]);
    const main = r.doc.components.main!;
    const before = doc.components.main!;
    expect(r.doc.components.grow).toStrictEqual({
      formatVersion: 1,
      id: "grow",
      name: "Grow",
      kind: "patchComponent",
      interface: {
        inputs: { number: { key: "number", name: "Number", type: "number" } },
        outputs: { output: { key: "output", name: "Output", type: "number", link: "grow.output" } },
      },
      layers: [],
      patches: { pop: { ...before.patches.pop!, inputs: { ...before.patches.pop!.inputs, number: { link: "$in.number" } } }, grow: before.patches.grow },
      comments: [],
    });
    expect(main.patches.grow_2).toStrictEqual({ type: "component", name: "Grow", component: "grow", inputs: { number: { link: "toggle.on" } }, ui: { x: 440, y: 40 } });
    expect(main.layers[0]!.props.scale).toEqual({ link: "grow_2.output" });
    expect(errorsOf(r.doc)).toEqual([]);
    expectRoundTrip(doc, r);
  });

  it("keeps the artboard size when frames are linked", () => {
    const doc = mustApply(buttonDoc(), [{ op: "setInput", target: "@bg.position", value: { link: "tap.position" } }]).doc;
    const r = mustApply(doc, [{ op: "createComponent", name: "Backdrop", layerIds: ["bg"] }]);
    expect(r.doc.components.backdrop!.size).toEqual([390, 844]);
    expect(r.doc.components.main!.layers[0]!.props).toEqual({ position_2: { link: "tap.position" }, size: [390, 844] });
    expect(r.doc.components.backdrop!.layers[0]!.props).toEqual({ position: { link: "$in.position_2" } });
    expectRoundTrip(doc, r);
  });

  it("explains invalid selections", () => {
    const doc = buttonDoc();
    expect(firstError(doc, [{ op: "createComponent", name: "X" }]).code).toBe("nothing_selected");
    expect(firstError(doc, [{ op: "createComponent", name: "X", layerIds: ["bg", "label"] }]).code).toBe("different_parents");
    expect(firstError(doc, [{ op: "createComponent", name: "X", layerIds: ["nope"] }]).code).toBe("not_found");
    expect(firstError(doc, [{ op: "createComponent", name: " ", patchIds: ["pop"] }]).code).toBe("invalid_value");
  });
});
