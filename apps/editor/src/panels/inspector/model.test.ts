import { applyOps, createEmptyDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { getRegistry } from "../../state/registry.ts";
import {
  editLabel,
  encodeDefault,
  formatCopies,
  formatLiveValue,
  intersectFields,
  layerSections,
  layerSources,
  linkSourceItem,
  offsetNumber,
  patchSources,
  planFieldDisconnect,
  planFieldReset,
  planFieldSet,
  splitAdvanced,
  subjectLabel,
  updateVectorComponent,
  type InspectorField,
} from "./model.ts";

const registry = getRegistry();

function apply(doc: SonobeDocument, ops: Op[]): SonobeDocument {
  const result = applyOps(doc, ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

const fixture = () =>
  apply(createEmptyDocument(), [
    { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card", props: { position: [10, 20], opacity: 0.5 } } },
    { op: "addLayer", layer: { id: "dot", type: "oval", name: "Dot", props: { opacity: 0.8 } } },
    { op: "addLayer", layer: { id: "label", type: "text", name: "Label" } },
    { op: "addPatch", patch: { id: "grow", type: "transition", typeParam: "number", inputs: { start: 1, end: 1.2 }, ui: { x: 0, y: 0 } } },
    { op: "addPatch", patch: { id: "pop", type: "popAnimation", typeParam: "number", inputs: { bounciness: 8 }, ui: { x: 0, y: 200 } } },
    { op: "connect", from: "grow.output", to: "@card.scale" },
    { op: "connect", from: "pop.output", to: "grow.progress" },
  ]);

const field = (fields: InspectorField[], key: string) => fields.find((f) => f.key === key)!;

describe("inspector fields", () => {
  it("builds a single layer's fields with defaults, links, and sections", () => {
    const doc = fixture();
    const fields = intersectFields(layerSources(doc, "main", ["card"], registry));
    expect(field(fields, "position")).toMatchObject({ value: [10, 20], isSet: true, mixed: false, link: undefined });
    expect(field(fields, "color")).toMatchObject({ value: "#D9D9D9FF", isSet: false });
    expect(field(fields, "scale")).toMatchObject({ link: "grow.output", linkedCount: 1 });
    expect(field(fields, "gradient").value).toBeNull();
    const sections = layerSections(fields);
    expect(sections.map((s) => s.id)).toEqual(["basics", "fill", "stroke", "shadow", "layout", "transform", "filters", "interaction"]);
    const transform = splitAdvanced(sections.find((s) => s.id === "transform")!.fields);
    expect(transform.primary.map((f) => f.key)).toEqual(["scale", "rotation", "pivot"]);
    expect(transform.more.map((f) => f.key)).toEqual(["scaleXYZ", "rotationX", "rotationY", "zPosition"]);
  });

  it("intersects a multi-selection and flags mixed values", () => {
    const doc = fixture();
    const fields = intersectFields(layerSources(doc, "main", ["card", "dot"], registry));
    expect(fields.some((f) => f.key === "cornerRadius")).toBe(false);
    expect(field(fields, "opacity")).toMatchObject({ mixed: true, value: 0.5 });
    expect(field(fields, "scale")).toMatchObject({ mixed: true, link: undefined, linkedCount: 1 });
    const withText = intersectFields(layerSources(doc, "main", ["card", "label"], registry));
    expect(field(withText, "widthMode").mixed).toBe(true);
  });

  it("plans absolute, relative, reset, and disconnect edits", () => {
    const doc = fixture();
    const main = doc.components.main!;
    const fields = intersectFields(layerSources(doc, "main", ["card", "dot"], registry));
    const opacity = field(fields, "opacity");
    expect(planFieldSet(main, opacity, 1)).toEqual([
      { op: "setInput", component: "main", target: "@card.opacity", value: 1 },
      { op: "setInput", component: "main", target: "@dot.opacity", value: 1 },
    ]);
    const relative = apply(doc, planFieldSet(main, opacity, offsetNumber(0.1)));
    expect(relative.components.main!.layers.map((l) => l.props.opacity)).toEqual([0.6, 0.9, undefined]);
    expect(planFieldSet(main, field(fields, "enabled"), true)).toEqual([]);
    expect(planFieldReset(main, opacity)).toHaveLength(2);
    expect(planFieldDisconnect(main, field(fields, "scale"))).toEqual([{ op: "disconnect", component: "main", to: "@card.scale" }]);
    const moved = apply(doc, planFieldSet(main, field(fields, "position"), updateVectorComponent(1, 0, 5, true)));
    expect(moved.components.main!.layers[0]!.props.position).toEqual([10, 25]);
    expect(moved.components.main!.layers[1]!.props.position).toEqual([0, 5]);
  });

  it("builds patch fields with linked inputs", () => {
    const doc = fixture();
    const fields = intersectFields(patchSources(doc, "main", ["grow"], registry));
    expect(fields.map((f) => f.key)).toEqual(["progress", "start", "end"]);
    expect(field(fields, "progress").link).toBe("pop.output");
    expect(field(fields, "end").value).toBe(1.2);
    expect(linkSourceItem("pop.output")).toEqual({ kind: "patch", id: "pop", key: "output" });
    expect(linkSourceItem("@card.size")).toEqual({ kind: "layer", id: "card", key: "size" });
  });

  it("puts a component instance's published inputs first", () => {
    const doc = apply(fixture(), [
      { op: "addComponent", component: { id: "chip", name: "Chip", kind: "layerComponent", size: [80, 32] } },
      { op: "updateInterface", component: "chip", inputs: { title: { key: "title", name: "Title", type: "text", default: "Hello" } } },
      { op: "addLayer", layer: { id: "chip_1", type: "componentInstance", name: "Chip", component: "chip" } },
    ]);
    const fields = intersectFields(layerSources(doc, "main", ["chip_1"], registry));
    const sections = layerSections(fields);
    expect(sections[0]).toMatchObject({ id: "component", title: "Component Inputs" });
    expect(sections[0]!.fields[0]).toMatchObject({ key: "title", value: "Hello" });
  });

  it("formats defaults, labels, and live values", () => {
    expect(encodeDefault({ key: "c", name: "C", type: "color", default: "#FFFFFFFF", description: "" })).toBe("#FFFFFFFF");
    expect(encodeDefault({ key: "m", name: "M", type: "enum", enumOptions: [{ key: "fixed", name: "Fixed" }], description: "" })).toBe("fixed");
    expect(formatLiveValue({ r: 1, g: 0, b: 0, a: 1 }, "color")).toBe("#FF0000FF");
    expect(formatLiveValue([1.23456, 2], "point")).toBe("1.235, 2");
    expect(formatLiveValue({ __loop: true, items: [1, 2, 3] }, "number")).toBe("×3 · 1");
    expect(formatLiveValue(true, "boolean")).toBe("On");
    expect(formatLiveValue(undefined, "number")).toBe("—");
    expect([formatCopies(4), formatCopies(1), formatCopies(undefined)]).toEqual(["4 copies", "1 copy", "—"]);
    expect(subjectLabel(["Card"], "layer")).toBe("Card");
    expect(subjectLabel(["Card", "Dot"], "patch")).toBe("2 patches");
    expect(editLabel({ port: { key: "opacity", name: "Opacity", type: "number", description: "" } }, "Card")).toBe("Set Opacity on Card");
  });
});
