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
    const first = mustApply(doc, [{ op: "updateComponent", id: "main", meta: { importer: { source: { figma: "abc" } }, zoom: 1.5 } }]);
    expect(first.doc.components.main!.meta).toEqual({ importer: { source: { figma: "abc" } }, zoom: 1.5 });
    expect(first.inverse).toEqual([{ op: "updateComponent", id: "main", meta: null }]);
    expectRoundTrip(doc, first);

    const second = mustApply(first.doc, [{ op: "updateComponent", id: "main", meta: { zoom: null, grid: true, importer: { source: {} } } }]);
    expect(second.doc.components.main!.meta).toEqual({ importer: { source: {} }, grid: true });
    expect(second.inverse).toEqual([{ op: "updateComponent", id: "main", meta: { zoom: 1.5, grid: null, importer: { source: { figma: "abc" } } } }]);
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

describe("component ids and script names on case-insensitive file systems", () => {
  it("rejects an explicit id that differs from an existing one only by case", () => {
    const doc = mustApply(emptyDoc(), [{ op: "addComponent", component: { id: "card", name: "Card", kind: "layerComponent" } }]).doc;
    const e = firstError(doc, [{ op: "addComponent", component: { id: "Card", name: "Card", kind: "layerComponent" } }]);
    expect(e).toMatchObject({ code: "id_taken", message: expect.stringContaining('share a file with the component "card"') });
  });

  it("derives ids that don't share a file with existing components", () => {
    const r = mustApply(emptyDoc(), [
      { op: "addComponent", component: { name: "TabBar", kind: "layerComponent" } },
      { op: "addComponent", component: { name: "Tabbar", kind: "layerComponent" } },
      { op: "addComponent", component: { name: "NavBar", kind: "layerComponent" } },
      { op: "addLayer", layer: { id: "bar", type: "rectangle", name: "Bar" } },
      { op: "createComponent", name: "Navbar", layerIds: ["bar"] },
    ]);
    expect(r.results.map((x) => x.ids?.[0])).toEqual(["tabBar", "tabbar_2", "navBar", "bar", "navbar_2"]);
  });

  it("rejects a script name that differs from an existing one only by case", () => {
    const doc = mustApply(emptyDoc(), [{ op: "setScript", file: "js_1.js", source: "// lower" }]).doc;
    expect(firstError(doc, [{ op: "setScript", file: "JS_1.js", source: "// upper" }]).code).toBe("file_name_taken");
    expect(mustApply(doc, [{ op: "setScript", file: "js_1.js", source: "// updated" }]).doc.scripts).toEqual({ "js_1.js": "// updated" });
    expect(mustApply(doc, [{ op: "setScript", file: "js_1.js", source: null }]).doc.scripts).toEqual({});
  });

  it("still undoes a removal (the original id is free again by then)", () => {
    const doc = mustApply(emptyDoc(), [{ op: "addComponent", component: { id: "card", name: "Card", kind: "layerComponent" } }]).doc;
    const removed = mustApply(doc, [{ op: "removeComponent", id: "card" }]);
    expectRoundTrip(doc, removed, { lenient: true });
  });
});

describe("addComponent checks its content like addLayer and addPatch", () => {
  it("manages formatVersion itself", () => {
    expect(firstError(emptyDoc(), [{ op: "addComponent", component: { name: "Card", kind: "layerComponent", formatVersion: 99 } }])).toMatchObject({ code: "invalid_op", message: expect.stringContaining("managed by Sonobe") });
    expect(mustApply(emptyDoc(), [{ op: "addComponent", component: { name: "Card", kind: "layerComponent", formatVersion: 1 } }]).doc.components.card!.formatVersion).toBe(1);
    const lenient = mustApply(emptyDoc(), [{ op: "addComponent", component: { name: "Card", kind: "layerComponent", formatVersion: 99 } }], { lenient: true });
    expect(lenient.doc.components.card!.formatVersion).toBe(1);
  });

  it("rejects instances of itself, missing components, and cycles", () => {
    const self = firstError(emptyDoc(), [{ op: "addComponent", component: { id: "card", name: "Card", kind: "layerComponent", layers: [{ id: "inner", type: "componentInstance", name: "Inner", component: "card", props: {} }] } }]);
    expect(self).toMatchObject({ code: "component_cycle", message: expect.stringContaining('In the new component "card"') });
    const ghost = firstError(emptyDoc(), [{ op: "addComponent", component: { name: "Row", kind: "layerComponent", layers: [{ id: "x", type: "componentInstance", name: "X", component: "ghost", props: {} }] } }]);
    expect(ghost.code).toBe("not_found");
    const patchSelf = firstError(emptyDoc(), [{ op: "addComponent", component: { id: "logic", name: "Logic", kind: "patchComponent", patches: { again: { type: "component", component: "logic", inputs: {}, ui: { x: 0, y: 0 } } } } }]);
    expect(patchSelf.code).toBe("component_cycle");
  });

  it("rejects dangling links, unknown ports and unknown types", () => {
    const withPatches = (patches: Record<string, unknown>) => [{ op: "addComponent", component: { name: "Logic", kind: "patchComponent", patches } } as Op];
    expect(firstError(emptyDoc(), withPatches({ flip: { type: "switch", inputs: { flip: { link: "ghost.out" } }, ui: { x: 0, y: 0 } } })).code).toBe("not_found");
    expect(firstError(emptyDoc(), withPatches({ flip: { type: "switch", inputs: { nonsense: 1 }, ui: { x: 0, y: 0 } } })).code).toBe("unknown_port");
    expect(firstError(emptyDoc(), withPatches({ warp: { type: "warpDrive", inputs: {}, ui: { x: 0, y: 0 } } })).code).toBe("unknown_patch_type");
    expect(firstError(emptyDoc(), [{ op: "addComponent", component: { name: "Card", kind: "layerComponent", layers: [{ id: "x", type: "hologram", name: "X", props: {} }] } }]).code).toBe("unknown_layer_type");
    const badOutput = firstError(emptyDoc(), [{ op: "addComponent", component: { name: "Logic", kind: "patchComponent", interface: { inputs: {}, outputs: { v: { key: "v", name: "V", type: "number", link: "ghost.output" } } } } }]);
    expect(badOutput.code).toBe("not_found");
  });

  it("accepts links between its own items in any order", () => {
    const r = mustApply(emptyDoc(), [
      {
        op: "addComponent",
        component: {
          name: "Logic",
          kind: "patchComponent",
          interface: { inputs: { target: { key: "target", name: "Target", type: "number", default: 1 } }, outputs: { value: { key: "value", name: "Value", type: "number", link: "spring.output" } } },
          patches: {
            spring: { type: "popAnimation", inputs: { number: { link: "$in.target" } }, ui: { x: 0, y: 0 } },
            toggle: { type: "switch", inputs: { flip: { link: "tap.tap" } }, ui: { x: 0, y: 0 } },
            tap: { type: "interaction", inputs: {}, ui: { x: 0, y: 0 } },
          },
        },
      },
    ]);
    expect(errorsOf(r.doc)).toEqual([]);
    expectRoundTrip(emptyDoc(), r);
  });

  it("restores components that already carry problems when applied leniently (undo, redo)", () => {
    const doc = mustApply(emptyDoc(), [{ op: "addComponent", component: { name: "Logic", kind: "patchComponent", patches: { flip: { type: "switch", inputs: { flip: { link: "ghost.out" } }, ui: { x: 0, y: 0 } } } } }], { lenient: true }).doc;
    expect(errorsOf(doc).map((d) => d.code)).toContain("dangling_link");
    const removed = mustApply(doc, [{ op: "removeComponent", id: "logic" }]);
    expectRoundTrip(doc, removed, { lenient: true });
  });
});

describe("ids equal to Object.prototype members", () => {
  it("reports missing items instead of reading inherited members", () => {
    const doc = mustApply(emptyDoc(), [{ op: "addPatch", patch: { id: "sw", type: "switch" } }]).doc;
    for (const id of ["toString", "valueOf", "constructor", "hasOwnProperty"]) {
      expect(firstError(doc, [{ op: "updatePatch", id, name: "Oops" }]).code).toBe("not_found");
      expect(firstError(doc, [{ op: "removePatch", id }]).code).toBe("not_found");
    }
    expect(firstError(doc, [{ op: "connect", from: "constructor.on", to: "sw.flip" }]).code).toBe("not_found");
    expect(firstError(doc, [{ op: "setInput", target: "toString.flip", value: 1 }]).code).toBe("not_found");
    expect(firstError(doc, [{ op: "removePatch", component: "hasOwnProperty", id: "sw" }]).code).toBe("not_found");
    expect(firstError(doc, [{ op: "addLayer", layer: { type: "componentInstance", component: "constructor" } }]).code).toBe("not_found");
  });

  it("allows those names as real ids, but never __proto__", () => {
    const r = mustApply(emptyDoc(), [
      { op: "addComponent", component: { id: "constructor", name: "Constructor", kind: "patchComponent" } },
      { op: "addPatch", patch: { name: "Constructor", type: "switch" } },
    ]);
    expect(Object.keys(r.doc.components).sort()).toEqual(["constructor", "main"]);
    expect(Object.keys(r.doc.components.main!.patches)).toEqual(["constructor"]);
    expect(mustApply(r.doc, [{ op: "removePatch", id: "constructor" }]).doc.components.main!.patches).toEqual({});
    expect(firstError(emptyDoc(), [{ op: "addPatch", patch: { id: "__proto__", type: "switch" } }]).code).toBe("invalid_id");
    expect(firstError(emptyDoc(), [{ op: "setScript", file: "__proto__", source: "x" }]).code).toBe("invalid_value");
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

  /** A patch component with two inputs and two outputs, used by a patch instance in main. */
  const logicDoc = () =>
    mustApply(emptyDoc(), [
      { op: "addComponent", component: { id: "logic", name: "Logic", kind: "patchComponent" } },
      {
        op: "updateInterface",
        component: "logic",
        inputs: { down: { name: "Down", type: "boolean" }, flip: { name: "Flip", type: "pulse" } },
        outputs: { on: { name: "On", type: "boolean" }, count: { name: "Count", type: "number" } },
      },
      { op: "addPatch", component: "logic", patch: { id: "held", type: "switch", inputs: { turnOn: { link: "$in.down" }, flip: { link: "$in.flip" } } } },
      { op: "addPatch", component: "logic", patch: { id: "taps", type: "counter", inputs: { increase: { link: "$in.flip" } } } },
      { op: "connect", component: "logic", from: "held.on", to: "$out.on" },
      { op: "connect", component: "logic", from: "taps.count", to: "$out.count" },
      { op: "addPatch", patch: { id: "tap", type: "interaction" } },
      { op: "addPatch", patch: { id: "inst", type: "component", component: "logic", inputs: { down: { link: "tap.down" }, flip: { link: "tap.tap" } } } },
      { op: "addLayer", layer: { id: "card", type: "rectangle", props: { opacity: { link: "inst.count" } } } },
      { op: "addPatch", patch: { id: "grow", type: "popAnimation", inputs: { number: { link: "inst.on" } } } },
    ]).doc;

  it("replace: true makes each given side the whole set, cascading like null, and round-trips", () => {
    const doc = logicDoc();
    const r = mustApply(doc, [{ op: "updateInterface", component: "logic", replace: true, inputs: { down: { name: "Down", type: "boolean" } }, outputs: { on: { name: "On", type: "boolean" } } }]);
    const logic = r.doc.components.logic!;
    expect(Object.keys(logic.interface.inputs)).toEqual(["down"]);
    expect(Object.keys(logic.interface.outputs)).toEqual(["on"]);
    expect(logic.patches.held!.inputs).toEqual({ turnOn: { link: "$in.down" } });
    expect(logic.patches.taps!.inputs).toEqual({});
    expect(r.doc.components.main!.patches.inst!.inputs).toEqual({ down: { link: "tap.down" } });
    expect(r.doc.components.main!.layers[0]!.props).toEqual({});
    // "on" was declared again without a link, so it keeps its cable, and so does its reader.
    expect(logic.interface.outputs.on!.link).toBe("held.on");
    expect(r.doc.components.main!.patches.grow!.inputs).toEqual({ number: { link: "inst.on" } });
    // Stored in explicit form, so redo doesn't depend on the document.
    expect(r.applied).toEqual([
      {
        op: "updateInterface",
        component: "logic",
        inputs: { flip: null, down: { key: "down", name: "Down", type: "boolean" } },
        outputs: { count: null, on: { key: "on", name: "On", type: "boolean", link: "held.on" } },
      },
    ]);
    expect(r.inverse[0]).toMatchObject({ outputs: { count: { key: "count", link: "taps.count" }, on: { key: "on", link: "held.on" } } });
    expect(errorsOf(r.doc)).toEqual([]);
    expectRoundTrip(doc, r);
  });

  it("replace leaves a side it isn't given alone, and an empty side unpublishes every port", () => {
    const doc = logicDoc();
    const r = mustApply(doc, [{ op: "updateInterface", component: "logic", replace: true, inputs: {} }]);
    expect(r.doc.components.logic!.interface.inputs).toEqual({});
    expect(Object.keys(r.doc.components.logic!.interface.outputs)).toEqual(["on", "count"]);
    expect(r.doc.components.main!.patches.inst!.inputs).toEqual({});
    expectRoundTrip(doc, r);
    const merged = mustApply(doc, [{ op: "updateInterface", component: "logic", inputs: {} }]);
    expect(Object.keys(merged.doc.components.logic!.interface.inputs)).toEqual(["down", "flip"]);
  });

  it("keeps an output's cable when it's declared again without a link; link: null disconnects it", () => {
    const doc = logicDoc();
    const kept = mustApply(doc, [{ op: "updateInterface", component: "logic", outputs: { count: { name: "Taps", type: "number" } } }]);
    expect(kept.doc.components.logic!.interface.outputs.count).toEqual({ key: "count", name: "Taps", type: "number", link: "taps.count" });
    expectRoundTrip(doc, kept);
    const cut = mustApply(doc, [{ op: "updateInterface", component: "logic", outputs: { count: { name: "Taps", type: "number", link: null } } }]);
    expect(cut.doc.components.logic!.interface.outputs.count).toEqual({ key: "count", name: "Taps", type: "number" });
    expect(cut.applied).toEqual([{ op: "updateInterface", component: "logic", outputs: { count: { key: "count", name: "Taps", type: "number", link: null } } }]);
    expectRoundTrip(doc, cut);
    // Connecting an output that had no cable undoes back to no cable.
    const connected = mustApply(cut.doc, [{ op: "updateInterface", component: "logic", outputs: { count: { name: "Taps", type: "number", link: "taps.count" } } }]);
    expectRoundTrip(cut.doc, connected);
    const retyped = firstError(doc, [{ op: "updateInterface", component: "logic", outputs: { count: { name: "Taps", type: "color" } } }]);
    expect(retyped).toMatchObject({ code: "type_mismatch", message: expect.stringContaining("keeps its connection from taps.count"), hint: expect.stringContaining('"link": null') });
  });

  it("unpublishing an input disconnects links that read it off a layer instance", () => {
    const doc = setup();
    const withReads = mustApply(doc, [{ op: "addPatch", patch: { id: "log", type: "logger", inputs: { value: { link: "@chip_1.label" } } } }]).doc;
    const r = mustApply(withReads, [{ op: "updateInterface", component: "chip", inputs: { label: null } }]);
    expect(r.doc.components.main!.patches.log!.inputs).toEqual({});
    expect(r.doc.components.main!.patches.toggle!.inputs).toEqual({ flip: { link: "@chip_1.tapped" } });
    expect(errorsOf(r.doc)).toEqual([]);
    expectRoundTrip(withReads, r);
  });

  it("teaches the right shape for guessed fields", () => {
    const doc = logicDoc();
    const typo = firstError(doc, [{ op: "updateInterface", component: "logic", input: { a: { type: "number" } } } as unknown as Op]);
    expect(typo).toMatchObject({ code: "unknown_field", message: expect.stringContaining('Did you mean "inputs"?') });
    const mode = firstError(doc, [{ op: "updateInterface", component: "logic", mode: "replace", inputs: {} } as unknown as Op]);
    expect(mode.hint).toContain('"replace": true');
    expect(firstError(doc, [{ op: "updateInterface", component: "logic", replace: "yes" as unknown as boolean, inputs: {} }]).code).toBe("invalid_value");
    const field = firstError(doc, [{ op: "updateInterface", component: "logic", inputs: { depth: { name: "Depth", type: "number", defaultValue: 1 } as never } }]);
    expect(field).toMatchObject({ code: "unknown_field", message: expect.stringContaining('Did you mean "default"?') });
    const rename = firstError(doc, [{ op: "updateInterface", component: "logic", inputs: { down: { key: "pressed", name: "Pressed", type: "boolean" } } }]);
    expect(rename).toMatchObject({ code: "invalid_value", hint: expect.stringContaining('unpublish "down"') });
    expect(rename.suggestions![0]!.ops).toEqual([{ op: "updateInterface", component: "logic", inputs: { down: null, pressed: { key: "pressed", name: "Pressed", type: "boolean" } } }]);
    expect(apply(doc, rename.suggestions![0]!.ops!).ok).toBe(true);
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
