import { describe, expect, it } from "vitest";
import { buildSampleDocument, mockRegistry, mustApply } from "../testing/fixtures.ts";
import { deriveGraph } from "./deriveGraph.ts";
import type { ValueSubtype, ValueType } from "../types.ts";
import { componentNodeShapes, liveReserve, liveText, nodeShapeFromData, type NodeRowShape, type NodeShape, type ValueChip } from "./nodeShape.ts";
import { estimateNodeSize, knobValueRoom, liveRoom, liveRooms, measureNode, NODE_BOX, portCenterY, tableMeasurer } from "./nodeSize.ts";
import { componentNodeBoxes, estimatePatchSize } from "./placement.ts";
import type { PatchNodeData } from "./types.ts";

/** 6 pt per character in every font, so widths are easy to add up. */
const mono6 = (text: string) => [...text].length * 6;
const label = (n: number) => "x".repeat(n);
const patch = (rows: NodeRowShape[], extra: Partial<NodeShape> = {}): NodeShape => ({ kind: "patch", title: "P", chips: [], rows, ...extra });
const width = (shape: NodeShape) => measureNode(shape, mono6).width;
/** A row of a 20-character label (120 pt) and a value, so the row sets the width. */
const valueRow = (value: ValueChip, labelChars = 20) => width(patch([{ in: { label: label(labelChars), value } }]));

describe("measureNode", () => {
  it("follows the box model: min and max width, header, rows and padding", () => {
    expect(measureNode(patch([{ in: { label: "A" } }]), mono6)).toEqual({ width: NODE_BOX.minWidth, height: 28 + 2 + 22 + 6 });
    expect(measureNode(patch([{ in: { label: "A" } }, { out: { label: "B" } }]), mono6).height).toBe(28 + 2 + 44 + 6);
    expect(measureNode(patch([]), mono6)).toEqual({ width: 164, height: 34 });
    expect(measureNode({ kind: "interface", title: "In", chips: [], rows: [{ out: { label: "A" } }] }, mono6).width).toBe(140);
    expect(width(patch([{ in: { label: label(60) } }]))).toBe(320);
    expect(measureNode(patch([{ in: { label: label(60) } }], { title: "Pop", collapsed: true }), mono6)).toEqual({ width: 16 + 16 + 6 + 18, height: 28 });
  });

  it("sizes every inline value kind", () => {
    const base = 12 + 120 + 6;
    expect(valueRow({ kind: "number", text: "0.3" })).toBe(base + 10 + 18);
    expect(valueRow({ kind: "vector", texts: ["0", "0"] })).toBe(base + 22 + 2 + 22);
    expect(valueRow({ kind: "check", on: true, isDefault: true }, 25)).toBe(12 + 150 + 6 + 14);
    expect(valueRow({ kind: "check", on: false, isDefault: false }, 25)).toBe(12 + 150 + 6 + 14);
    expect(valueRow({ kind: "menu", text: "Linear" })).toBe(base + 10 + 36 + 4 + 10);
    expect(valueRow({ kind: "color", hex: "FF375F" })).toBe(base + 8 + 10 + 4 + 36);
    expect(valueRow({ kind: "text", text: "Hello" })).toBe(base + 10 + 30);
    expect(valueRow({ kind: "text", text: "" })).toBe(base + 10 + 30);
    expect(valueRow({ kind: "text", text: label(30) })).toBe(base + 110);
    expect(valueRow({ kind: "static", text: "×4" }, 25)).toBe(12 + 150 + 6 + 10 + 12);
    expect(valueRow({ kind: "knob", name: "Damping", text: "0.75" })).toBe(base + 10 + 10 + 4 + 42 + 4 + 24);
    // A reserve of 4 characters is 4 ch and the half point that keeps a full-length value from ending in "…".
    expect(valueRow({ kind: "knob", name: "Damping", text: "0.5", reserve: 4 })).toBe(Math.ceil(base + 10 + 10 + 4 + 42 + 4 + 24.5));
    expect(valueRow({ kind: "knob", name: "Damping", text: "12.25", reserve: 4 })).toBe(base + 10 + 10 + 4 + 42 + 4 + 30);
    expect(valueRow({ kind: "knob", name: "Tint", swatch: "#FF375FFF" })).toBe(base + 10 + 10 + 4 + 24 + 4 + 10);
  });

  it("keeps a knob's whole name, and makes the chip as wide as chips get when the name leaves less than the value's reserve", () => {
    const base = 12 + 120 + 6;
    // 110 less 28 for the padding, glyph and gaps, 48 for "Card Ang" and 2 of slack leaves 32, more than the 30.5 "-180°" needs.
    expect(knobValueRoom({ name: "Card Ang", valueReserve: 5 }, mono6)).toBeUndefined();
    expect(valueRow({ kind: "knob", name: "Card Ang", text: "0°", reserve: 5 })).toBe(Math.ceil(base + 28 + 48 + 30.5));
    // "Card Angle" leaves 20: the value keeps that, and the chip is 110 whatever the value prints.
    expect(knobValueRoom({ name: "Card Angle", valueReserve: 5 }, mono6)).toBe(20);
    expect(valueRow({ kind: "knob", name: "Card Angle", text: "0°", reserve: 5 })).toBe(base + 110);
    expect(valueRow({ kind: "knob", name: "Card Angle", text: "-179°", reserve: 5 })).toBe(base + 110);
    expect(knobValueRoom({ name: "Gap" }, mono6)).toBeUndefined();
  });

  it("adds live values (at most 96 pt) and the Drive button", () => {
    expect(width(patch([{ in: { label: label(20) }, out: { label: "Output", live: "0.5" } }]))).toBe(12 + 120 + 12 + 18 + 6 + 36 + 12);
    expect(width(patch([{ in: { label: label(20) }, out: { label: "Output", live: label(30) } }]))).toBe(12 + 120 + 12 + 96 + 6 + 36 + 12);
    expect(width({ kind: "layer", title: "Card", chips: [], rows: [{ in: { label: label(20), drive: true } }] })).toBe(12 + 120 + 6 + 14 + 36);
  });

  it("keeps a live value's slot at its reserve (in characters of the mono font, and half a point), at most 96 pt, and only while a value shows", () => {
    expect(width(patch([{ in: { label: label(20) }, out: { label: "Output", live: "Off", reserve: 3 } }]))).toBe(Math.ceil(12 + 120 + 12 + 18.5 + 6 + 36 + 12));
    expect(width(patch([{ in: { label: label(20) }, out: { label: "Output", live: "0", reserve: 8 } }]))).toBe(Math.ceil(12 + 120 + 12 + 48.5 + 6 + 36 + 12));
    expect(width(patch([{ in: { label: label(20) }, out: { label: "Output", live: "0, 0", reserve: 18 } }]))).toBe(12 + 120 + 12 + 96 + 6 + 36 + 12);
    expect(width(patch([{ in: { label: label(20) }, out: { label: "Output", reserve: 8 } }]))).toBe(12 + 120 + 12 + 36 + 12);
  });

  it("ends a value longer than its reserve in an ellipsis instead of widening the node", () => {
    const at = (live: string) => width(patch([{ in: { label: label(20) }, out: { label: "Output", live, reserve: 14 } }]));
    expect(at("0, 0")).toBe(Math.ceil(12 + 120 + 12 + 84.5 + 6 + 36 + 12));
    expect(at("1931.5, -1229.1")).toBe(at("0, 0"));
  });

  it("caps a live value's reserve to the room its row leaves under the maximum width, so labels stay whole", () => {
    const long = (live: string): NodeRowShape => ({ in: { label: label(20) }, out: { label: label(20), live, reserve: 8 } });
    // 12 + 120 + 12 + 120 + 12 = 276 without the value: 320 less 2 of slack, 276 and the 6 pt gap leaves 36 of the 48 reserved.
    expect(liveRoom(long("0"), mono6)).toBe(36);
    expect(width(patch([long("0")]))).toBe(276 + 36 + 6);
    expect(width(patch([long("12.5")]))).toBe(276 + 36 + 6);
    // A value wider than the room ends in "…" there.
    expect(width(patch([long("-1234.5")]))).toBe(276 + 36 + 6);
    expect(liveRoom({ in: { label: "A" }, out: { label: "B" } }, mono6)).toBe(96);
    expect(liveRoom({ in: { label: label(60) }, out: { label: "B" } }, mono6)).toBe(0);
    // A row that leaves less than 4 characters keeps 4, and its labels give way.
    const crowded: NodeRowShape = { in: { label: label(20) }, out: { label: label(23), live: "0", reserve: 8 } };
    expect(liveRoom(crowded, mono6)).toBe(18);
    expect(width(patch([crowded]))).toBe(320);
  });

  it("adds header chips", () => {
    const title = label(20);
    const header = 16 + 16 + 6 + 120;
    expect(width(patch([], { title, chips: [{ kind: "chip", text: "Number" }] }))).toBe(header + 6 + 10 + 36);
    expect(width(patch([], { title, chips: [{ kind: "loop", text: "×4" }] }))).toBe(header + 6 + 22);
    expect(width(patch([], { title, chips: [{ kind: "badge" }, { kind: "enter" }] }))).toBe(header + 6 + 16 + 6 + 11);
    expect(width(patch([], { title, chips: [{ kind: "working", text: "Claude" }] }))).toBe(header + 6 + 11 + 10 + 36);
  });

  it("places port handles at their rows", () => {
    expect(portCenterY({}, 0)).toBe(41);
    expect(portCenterY({}, 2)).toBe(85);
    expect(portCenterY({ collapsed: true }, 3)).toBe(14);
  });

  it("measures text from the SF Pro / SF Mono table", () => {
    expect(tableMeasurer("Pop Animation", "title")).toBeGreaterThan(tableMeasurer("Pop Animation", "label"));
    expect(tableMeasurer("0.000", "mono10")).toBeCloseTo(5 * tableMeasurer("0", "mono10"));
    expect(tableMeasurer("漢", "label")).toBeGreaterThan(0);
  });
});

describe("node shapes from the graph", () => {
  it("shows what the patch editor shows: inline values of unconnected inputs, layer type chips, driven properties", () => {
    const doc = buildSampleDocument();
    const shapes = componentNodeShapes(doc, mockRegistry, "main");
    const grow = shapes.get("grow")!;
    expect(grow.chips).toEqual([]);
    expect(grow.rows.map((r) => r.in)).toEqual([{ label: "Progress" }, { label: "Start", value: { kind: "number", text: "1" } }, { label: "End", value: { kind: "number", text: "1.08" } }]);
    expect(grow.rows[0]!.out).toEqual({ label: "Output" });
    const card = shapes.get("@card")!;
    expect(card).toMatchObject({ kind: "layer", title: "Card", chips: [{ kind: "chip", text: "Group" }] });
    expect(card.rows).toEqual([{ in: { label: "Scale" } }]);
    expect(shapes.has("note_1")).toBe(false);
  });

  it("gives every live value that prints a reserve, by the port's type and what it measures", () => {
    const port = (type: ValueType, subtype?: ValueSubtype) => ({ type, ...(subtype ? { subtype } : {}) });
    const values: [ValueType, unknown][] = [
      ["number", 0.5],
      ["index", 3],
      ["boolean", true],
      ["color", { r: 1, g: 0, b: 0, a: 1 }],
      ["text", ""],
      ["point", [0, 0]],
      ["enum", "a"],
      ["layer", "card"],
      ["json", { a: 1 }],
      ["any", null],
      ["number", { __loop: true, items: [] }],
    ];
    for (const [type, value] of values) {
      expect(liveText(port(type), value), type).not.toBe("");
      expect(liveReserve(port(type), value), type).toBeGreaterThan(0);
    }
    expect(liveText(port("pulse"), true)).toBe("");
    expect(liveReserve(port("pulse"), true)).toBe(0);
    expect(liveReserve(port("number", "progress"), 0.5)).toBe(6);
    expect(liveReserve(port("number", "distance"), 0.5)).toBe(8);
  });

  it("prints live values when given them, in a slot as wide as the longest number, which widens the node", () => {
    const doc = buildSampleDocument();
    const data = deriveGraph({ doc, componentId: "main", registry: mockRegistry }).nodes.find((n) => n.id === "grow")!.data as PatchNodeData;
    const shape = nodeShapeFromData(data, { live: (address) => (address === "grow.output" ? 1.04 : undefined) });
    expect(shape.rows[0]!.out).toEqual({ label: "Output", live: "1.04", reserve: 8 });
    // "1.04" and "-1234.6" both take the 8 characters of "-99999.9": the node keeps its width as the value runs.
    const at = (value: number) => estimateNodeSize(data, { live: () => value, measure: mono6 }).width;
    expect(at(-1234.567)).toBe(Math.ceil(12 + 48 + 12 + 48.5 + 6 + 36 + 12));
    expect(new Set([0, 0.5, -12.35, 100, 1.04, -99999.9].map(at))).toEqual(new Set([at(-1234.567)]));
    expect(estimateNodeSize(data, { measure: mono6 }).width).toBe(164);
  });

  it("gives an output in a long row its room for a live value, which the patch editor caps the reserve to", () => {
    /** 15 pt a character: Transition's "Progress" and "Output" row takes 12 + 120 + 12 + 90 + 12 = 246 without its value. */
    const wide = (text: string) => [...text].length * 15;
    const doc = buildSampleDocument();
    const grow = (measure: (text: string) => number) => deriveGraph({ doc, componentId: "main", registry: mockRegistry, measure }).nodes.find((n) => n.id === "grow")!.data as PatchNodeData;
    const data = grow(wide);
    expect(data.outputs[0]!.liveRoom).toBe(320 - 2 - 246 - 6);
    expect(liveRooms(data, { measure: wide })).toEqual([66]);
    const at = (value: number) => estimateNodeSize(data, { live: () => value, measure: wide }).width;
    expect(new Set([0, 0.5, 1.04, 1.5].map(at))).toEqual(new Set([246 + 66 + 6]));
    // With room for the whole slot, nothing is capped.
    expect(grow(mono6).outputs[0]!.liveRoom).toBeUndefined();
  });

  it("says whether a boolean input's box is checked, and whether that's its default", () => {
    const enabled = (value?: boolean) => {
      const doc = value === undefined ? buildSampleDocument() : mustApply(buildSampleDocument(), [{ op: "setInput", target: "tap_card.enabled", value }]).doc;
      const data = deriveGraph({ doc, componentId: "main", registry: mockRegistry }).nodes.find((n) => n.id === "tap_card")!.data as PatchNodeData;
      return nodeShapeFromData(data).rows.find((r) => r.in?.label === "Enabled")!.in!.value;
    };
    expect(enabled()).toEqual({ kind: "check", on: true, isDefault: true });
    expect(enabled(true)).toEqual({ kind: "check", on: true, isDefault: false });
    expect(enabled(false)).toEqual({ kind: "check", on: false, isDefault: false });
  });

  it("shows a knob-linked input as a chip with the knob's name", () => {
    const doc = buildSampleDocument();
    const data = deriveGraph({ doc, componentId: "main", registry: mockRegistry }).nodes.find((n) => n.id === "pop")!.data as PatchNodeData;
    const linked: PatchNodeData = { ...data, inputs: data.inputs.map((p) => (p.key === "bounciness" ? { ...p, connected: true, link: "$knob.bounce", knob: { id: "bounce", name: "Bounce", valueText: "8" } } : p)) };
    expect(nodeShapeFromData(linked).rows[1]!.in).toEqual({ label: "Bounciness", value: { kind: "knob", name: "Bounce", text: "8" } });
  });

  it("keeps a knob chip's value as wide as the longest value its slider reaches", () => {
    const tuned = (value: number) => {
      const doc = mustApply(buildSampleDocument(), [
        { op: "addKnob", knob: { id: "bounce", name: "Bounce", type: "number", value, min: 0, max: 20, step: 0.5 } },
        { op: "addPatch", patch: { id: "wobble", type: "popAnimation", inputs: { bounciness: { link: "$knob.bounce" } }, ui: { x: 0, y: 400 } } },
      ]).doc;
      const data = deriveGraph({ doc, componentId: "main", registry: mockRegistry }).nodes.find((n) => n.id === "wobble")!.data as PatchNodeData;
      return { chip: nodeShapeFromData(data).rows.find((r) => r.in?.label === "Bounciness")!.in!.value, width: estimateNodeSize(data, { measure: mono6 }).width };
    };
    expect(tuned(8).chip).toEqual({ kind: "knob", name: "Bounce", text: "8", reserve: 4 });
    expect(tuned(12.5).chip).toEqual({ kind: "knob", name: "Bounce", text: "12.5", reserve: 4 });
    expect(tuned(8).width).toBe(tuned(12.5).width);
  });

  it("gives a knob chip whose name leaves less than its value's reserve the room beside the name", () => {
    const knobOf = (name: string) => {
      const doc = mustApply(buildSampleDocument(), [
        { op: "addKnob", knob: { id: "angle", name, type: "number", value: 0, min: -180, max: 180, step: 1, unit: "°" } },
        { op: "addPatch", patch: { id: "wobble", type: "popAnimation", inputs: { bounciness: { link: "$knob.angle" } }, ui: { x: 0, y: 400 } } },
      ]).doc;
      const data = deriveGraph({ doc, componentId: "main", registry: mockRegistry, measure: mono6 }).nodes.find((n) => n.id === "wobble")!.data as PatchNodeData;
      return data.inputs.find((p) => p.key === "bounciness")!.knob!;
    };
    // "-180°" is 5 characters, 30.5 pt: "Angle" leaves 50 beside it, "Card Angle" 20.
    expect(knobOf("Angle")).toMatchObject({ valueReserve: 5 });
    expect(knobOf("Angle").valueRoom).toBeUndefined();
    expect(knobOf("Card Angle")).toMatchObject({ valueReserve: 5, valueRoom: 20 });
  });

  it("gives a color knob's chip a swatch of its running color instead of the hex", () => {
    const doc = mustApply(buildSampleDocument(), [
      { op: "addKnob", knob: { id: "tint", name: "Tint", type: "color", value: "#ff375f" } },
      { op: "addPatch", patch: { id: "fade", type: "transition", typeParam: "color", inputs: { start: { link: "$knob.tint" } }, ui: { x: 0, y: 400 } } },
    ]).doc;
    const data = deriveGraph({ doc, componentId: "main", registry: mockRegistry }).nodes.find((n) => n.id === "fade")!.data as PatchNodeData;
    expect(data.inputs.find((p) => p.key === "start")!.knob).toEqual({ id: "tint", name: "Tint", valueText: "#FF375FFF", color: "#FF375FFF" });
    expect(nodeShapeFromData(data).rows[1]!.in).toEqual({ label: "Start", value: { kind: "knob", name: "Tint", swatch: "#FF375FFF" } });
  });

  it("estimates a patch on its own and every node of a component", () => {
    const doc = buildSampleDocument();
    const size = estimatePatchSize(doc, mockRegistry, { type: "switch", inputs: {}, ui: { x: 0, y: 0 } });
    expect(size).toEqual({ width: 164, height: 28 + 2 + 3 * 22 + 6 });
    const boxes = componentNodeBoxes(doc, mockRegistry, "main");
    expect([...boxes.keys()].sort()).toEqual(["@card", "grow", "pop", "tap_card", "toggle"]);
    expect(boxes.get("grow")).toMatchObject({ x: doc.components.main!.patches.grow!.ui.x, y: 40 });
    // The layer node sits right of its driver, clear of it.
    expect(boxes.get("@card")!.x).toBeGreaterThanOrEqual(boxes.get("grow")!.x + boxes.get("grow")!.width + 96);
    const wide = mustApply(doc, [{ op: "updatePatch", id: "grow", name: "A very long patch name that someone typed to explain the idea" }]).doc;
    expect(componentNodeBoxes(wide, mockRegistry, "main").get("grow")!.width).toBe(320);
  });
});
