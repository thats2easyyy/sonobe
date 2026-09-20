import { describe, expect, it } from "vitest";
import { buildSampleDocument, mockRegistry, mustApply } from "../testing/fixtures.ts";
import { deriveGraph } from "./deriveGraph.ts";
import { componentNodeShapes, nodeShapeFromData, type NodeRowShape, type NodeShape, type ValueChip } from "./nodeShape.ts";
import { estimateNodeSize, measureNode, NODE_BOX, portCenterY, tableMeasurer } from "./nodeSize.ts";
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
    expect(valueRow({ kind: "knob", name: "Tint", swatch: "#FF375FFF" })).toBe(base + 10 + 10 + 4 + 24 + 4 + 10);
  });

  it("adds live values (at most 96 pt) and the Drive button", () => {
    expect(width(patch([{ in: { label: label(20) }, out: { label: "Output", live: "0.5" } }]))).toBe(12 + 120 + 12 + 18 + 6 + 36 + 12);
    expect(width(patch([{ in: { label: label(20) }, out: { label: "Output", live: label(30) } }]))).toBe(12 + 120 + 12 + 96 + 6 + 36 + 12);
    expect(width({ kind: "layer", title: "Card", chips: [], rows: [{ in: { label: label(20), drive: true } }] })).toBe(12 + 120 + 6 + 14 + 36);
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

  it("prints live values when given them, which widens the node", () => {
    const doc = buildSampleDocument();
    const data = deriveGraph({ doc, componentId: "main", registry: mockRegistry }).nodes.find((n) => n.id === "grow")!.data as PatchNodeData;
    const shape = nodeShapeFromData(data, { live: (address) => (address === "grow.output" ? 1.04 : undefined) });
    expect(shape.rows[0]!.out).toEqual({ label: "Output", live: "1.04" });
    expect(estimateNodeSize(data, { live: () => -1234.567, measure: mono6 }).width).toBe(12 + 48 + 12 + 42 + 6 + 36 + 12);
    expect(estimateNodeSize(data, { measure: mono6 }).width).toBe(164);
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
