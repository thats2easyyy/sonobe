import { describe, expect, it } from "vitest";
import {
  componentDependencies,
  createEmptyDocument,
  deviceScreenSize,
  findComponentInstances,
  getComponent,
  listComponentIds,
  newComponent,
  wouldCreateComponentCycle,
} from "./document.ts";
import {
  allLayerIds,
  COMPONENT_PATCH_SPEC,
  createRegistry,
  findLayer,
  isDescendantLayer,
  layerPath,
  resolveLayerOutputs,
  resolveLayerProps,
  resolveNodePorts,
  resolvePatchPorts,
  walkLayers,
} from "./registry.ts";
import { MOCK_PATCH_SPECS, mockRegistry } from "./testing/fixtures.ts";
import type { LayerNode, PatchNode, SonobeDocument } from "./types.ts";

const node = (type: string, extra: Partial<PatchNode> = {}): PatchNode => ({ type, inputs: {}, ui: { x: 0, y: 0 }, ...extra });

function docWithComponents(): SonobeDocument {
  const doc = createEmptyDocument({ device: "custom" });
  const button = newComponent({ id: "button", name: "Button", kind: "layerComponent" });
  button.interface.inputs = {
    label: { key: "label", name: "Label", type: "text", default: "Buy" },
    accent: { key: "accent", name: "Accent", type: "color", category: "fill" },
  };
  button.interface.outputs = { tapped: { key: "tapped", name: "Tapped", type: "pulse", link: "tap.tap" } };
  const debounce = newComponent({ id: "debounce", name: "Debounce", kind: "patchComponent" });
  debounce.interface.inputs = { value: { key: "value", name: "Value", type: "number" } };
  debounce.interface.outputs = { output: { key: "output", name: "Output", type: "number" } };
  const main = doc.components.main!;
  main.layers = [{ id: "btn", type: "componentInstance", name: "Btn", component: "button", props: {} }];
  main.patches = { deb: node("component", { component: "debounce" }) };
  return { ...doc, components: { main, button, debounce } };
}

describe("createRegistry", () => {
  it("indexes specs and adds the component patch type", () => {
    const r = createRegistry(MOCK_PATCH_SPECS);
    expect(r.patches.get("switch")?.name).toBe("Switch");
    expect(r.patches.get("component")).toBe(COMPONENT_PATCH_SPEC);
    expect(r.layers.get("rectangle")?.canHaveChildren).toBe(false);
  });

  it("rejects duplicate declarations", () => {
    expect(() => createRegistry([MOCK_PATCH_SPECS[0]!, MOCK_PATCH_SPECS[0]!])).toThrow(/declared twice/);
  });
});

describe("resolveNodePorts", () => {
  const doc = createEmptyDocument();

  it("resolves variant ports with the default first variant", () => {
    const ports = resolveNodePorts(doc, node("transition"), mockRegistry)!;
    expect(ports.typeParam).toBe("number");
    expect(ports.inputs.map((p) => [p.key, p.type])).toEqual([["progress", "number"], ["start", "number"], ["end", "number"]]);
    expect(ports.outputs[0]!.type).toBe("number");
  });

  it("resolves an explicit typeParam and coerces variant defaults", () => {
    const ports = resolveNodePorts(doc, node("transition", { typeParam: "color" }), mockRegistry)!;
    expect(ports.inputs[1]).toMatchObject({ key: "start", type: "color", default: { r: 0, g: 0, b: 0, a: 1 } });
    const bad = resolveNodePorts(doc, node("transition", { typeParam: "sound" }), mockRegistry)!;
    expect(bad.typeParam).toBe("number");
  });

  it("expands variadic ports and clamps the count", () => {
    const ports = resolveNodePorts(doc, node("add", { inputCount: 3, typeParam: "point" }), mockRegistry)!;
    expect(ports.inputs.map((p) => `${p.key}:${p.type}:${p.name}`)).toEqual(["value1:point:Value 1", "value2:point:Value 2", "value3:point:Value 3"]);
    expect(ports.inputs[2]!.variadicIndex).toBe(3);
    expect(resolveNodePorts(doc, node("add", { inputCount: 99 }), mockRegistry)!.inputs).toHaveLength(6);
    expect(resolveNodePorts(doc, node("add"), mockRegistry)!.inputCount).toBe(2);
  });

  it("merges dynamic ports and survives throwing declarations", () => {
    const js = node("javascript", { settings: { ports: { inputs: [["count", "number"]], outputs: [["label", "text"]] } } });
    const ports = resolveNodePorts(doc, js, mockRegistry)!;
    expect(ports.inputs.map((p) => p.key)).toEqual(["count"]);
    expect(ports.outputs.map((p) => p.type)).toEqual(["text"]);
    const broken = resolveNodePorts(doc, node("javascript", { settings: { broken: true } }), mockRegistry)!;
    expect(broken.dynamicPortsError).toContain("syntax error");
    expect(broken.inputs).toEqual([]);
  });

  it("uses a component's published interface for component patches", () => {
    const d = docWithComponents();
    const ports = resolvePatchPorts(d, "main", "deb", mockRegistry)!;
    expect(ports.inputs.map((p) => [p.key, p.type, p.fromInterface])).toEqual([["value", "number", true]]);
    expect(ports.outputs.map((p) => p.key)).toEqual(["output"]);
    expect(resolveNodePorts(d, node("component", { component: "missing" }), mockRegistry)!.inputs).toEqual([]);
    expect(resolveNodePorts(d, node("nope"), mockRegistry)).toBeUndefined();
  });
});

describe("resolveLayerProps", () => {
  it("returns type props and published inputs for instances", () => {
    const d = docWithComponents();
    const props = resolveLayerProps(d, "main", d.components.main!.layers[0]!, mockRegistry)!;
    const accent = props.find((p) => p.key === "accent")!;
    expect(accent).toMatchObject({ type: "color", category: "fill", fromInterface: true });
    expect(props.find((p) => p.key === "label")).toMatchObject({ type: "text", default: "Buy", category: "content" });
    expect(props.find((p) => p.key === "position")?.type).toBe("point");
    expect(resolveLayerProps(d, "main", { type: "sparkle" }, mockRegistry)).toBeUndefined();
  });

  it("returns layer outputs including instance outputs", () => {
    const d = docWithComponents();
    expect(resolveLayerOutputs(d, "main", d.components.main!.layers[0]!, mockRegistry).map((p) => p.key)).toEqual(["tapped"]);
    expect(resolveLayerOutputs(d, "main", { type: "textField" }, mockRegistry).map((p) => p.key)).toEqual(["value", "isFocused", "submitted"]);
  });
});

describe("layer tree helpers", () => {
  const tree: LayerNode[] = [
    { id: "bg", type: "rectangle", name: "Bg", props: {} },
    {
      id: "list",
      type: "group",
      name: "List",
      props: {},
      children: [
        { id: "row", type: "group", name: "Row", props: {}, children: [{ id: "label", type: "text", name: "Label", props: {} }] },
        { id: "divider", type: "rectangle", name: "Divider", props: {} },
      ],
    },
  ];

  it("finds layers with parent, index, depth and path", () => {
    const loc = findLayer(tree, "label")!;
    expect(loc.parent?.id).toBe("row");
    expect(loc.index).toBe(0);
    expect(loc.depth).toBe(2);
    expect(loc.path).toEqual(["list", "row", "label"]);
    expect(findLayer(tree, "divider")!.index).toBe(1);
    expect(findLayer(tree, "nope")).toBeUndefined();
    expect(layerPath(tree, "row")).toEqual(["list", "row"]);
    expect(isDescendantLayer(tree, "list", "label")).toBe(true);
    expect(isDescendantLayer(tree, "label", "list")).toBe(false);
  });

  it("walks back to front with skip and stop", () => {
    expect(allLayerIds(tree)).toEqual(["bg", "list", "row", "label", "divider"]);
    const skipped: string[] = [];
    walkLayers(tree, (l) => {
      skipped.push(l.id);
      return l.id === "row" ? "skip" : undefined;
    });
    expect(skipped).toEqual(["bg", "list", "row", "divider"]);
    const stopped: string[] = [];
    walkLayers(tree, (l) => {
      stopped.push(l.id);
      return l.id === "row" ? "stop" : undefined;
    });
    expect(stopped).toEqual(["bg", "list", "row"]);
  });
});

describe("document helpers", () => {
  it("creates an empty document sized from the device preset", () => {
    const doc = createEmptyDocument({ name: "Checkout", device: "iphone-17-pro" });
    expect(doc.project).toMatchObject({ formatVersion: 1, name: "Checkout", root: "main", device: { preset: "iphone-17-pro" } });
    expect(getComponent(doc)).toMatchObject({ id: "main", kind: "prototype", size: [402, 874], layers: [], patches: {}, comments: [] });
    expect(createEmptyDocument({ device: "unknown-phone" }).project.device.preset).toBe("iphone-17-pro");
    expect(deviceScreenSize({ preset: "iphone-se", orientation: "landscape" })).toEqual([667, 375]);
    expect(deviceScreenSize({ preset: "custom", size: [100, 200] })).toEqual([100, 200]);
  });

  it("builds components with defaults", () => {
    expect(newComponent({ id: "x", name: "X", kind: "layerComponent" }).size).toEqual([200, 100]);
    expect(newComponent({ id: "y", name: "Y", kind: "patchComponent" }).size).toBeUndefined();
  });

  it("finds instances and dependencies", () => {
    const d = docWithComponents();
    expect(listComponentIds(d)).toEqual(["main", "button", "debounce"]);
    expect(findComponentInstances(d, "button")).toEqual([{ componentId: "main", kind: "layer", id: "btn" }]);
    expect([...componentDependencies(d, "main")].sort()).toEqual(["button", "debounce"]);
    expect(wouldCreateComponentCycle(d, "button", "main")).toBe(true);
    expect(wouldCreateComponentCycle(d, "button", "debounce")).toBe(false);
    expect(wouldCreateComponentCycle(d, "button", "button")).toBe(true);
  });
});
