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
  getInputCountRange,
  isDescendantLayer,
  layerPath,
  resolveInputCount,
  resolveLayerOutputs,
  resolveLayerProps,
  resolveNodePorts,
  resolveNodeVariants,
  resolvePatchPorts,
  resolveTypeParam,
  walkLayers,
} from "./registry.ts";
import { emptyDoc, extendedRegistry, MOCK_PATCH_SPECS, mockRegistry, mustApply, port } from "./testing/fixtures.ts";
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

describe("layer lookups", () => {
  const tree = (): LayerNode[] => [
    { id: "a", type: "group", name: "A", props: {}, children: [{ id: "b", type: "rectangle", name: "B", props: {} }, { id: "dup", type: "rectangle", name: "Inner", props: {} }] },
    { id: "dup", type: "rectangle", name: "Outer", props: {} },
  ];

  it("finds the first match in walk order with its parent, index, depth and path", () => {
    const layers = tree();
    expect(findLayer(layers, "b")).toMatchObject({ parent: layers[0], index: 0, depth: 1, path: ["a", "b"] });
    expect(findLayer(layers, "a")).toMatchObject({ parent: null, index: 0, depth: 0, path: ["a"] });
    expect(findLayer(layers, "dup")?.layer.name).toBe("Inner");
    expect(findLayer(layers, "nope")).toBeUndefined();
    expect(findLayer(layers, "b")).toBe(findLayer(layers, "b"));
    expect(layerPath(layers, "dup")).toEqual(["a", "dup"]);
    expect(isDescendantLayer(layers, "a", "b")).toBe(true);
  });

  it("notices trees edited in place", () => {
    const layers = tree();
    expect(findLayer(layers, "c")).toBeUndefined();
    layers[0]!.children!.push({ id: "c", type: "rectangle", name: "C", props: {} });
    expect(findLayer(layers, "c")).toMatchObject({ index: 2, path: ["a", "c"] });
    layers[0]!.children!.splice(0, 1);
    expect(findLayer(layers, "b")).toBeUndefined();
    expect(findLayer(layers, "c")?.index).toBe(1);
    layers[1] = { id: "outer", type: "oval", name: "Oval", props: {} };
    expect(findLayer(layers, "outer")?.index).toBe(1);
    expect(findLayer(layers, "dup")?.layer.name).toBe("Inner");
  });
});

describe("resolveLayerProps sharing", () => {
  it("shares frozen props per layer type and follows a component's published inputs", () => {
    const doc = mustApply(emptyDoc(), [
      { op: "addComponent", component: { id: "button", name: "Button", kind: "layerComponent" } },
      { op: "updateInterface", component: "button", inputs: { label: { key: "label", name: "Label", type: "text" } } },
    ]).doc;
    const rect = resolveLayerProps(doc, "main", { type: "rectangle" }, mockRegistry)!;
    expect(resolveLayerProps(doc, "main", { type: "rectangle" }, mockRegistry)).toBe(rect);
    expect(Object.isFrozen(rect)).toBe(true);
    expect(Object.isFrozen(rect[0])).toBe(true);
    expect(() => (rect as unknown as unknown[]).push({})).toThrow();
    expect(resolveLayerOutputs(doc, "main", { type: "text" }, mockRegistry)).toBe(resolveLayerOutputs(doc, "main", { type: "text" }, mockRegistry));

    const instance = { type: "componentInstance", component: "button" };
    const labelled = resolveLayerProps(doc, "main", instance, mockRegistry)!;
    expect(labelled.find((p) => p.key === "label")).toMatchObject({ type: "text", fromInterface: true, category: "content" });
    expect(resolveLayerProps(doc, "main", instance, mockRegistry)).toBe(labelled);
    const retitled = mustApply(doc, [{ op: "updateInterface", component: "button", inputs: { title: { key: "title", name: "Title", type: "number" } } }]).doc;
    expect(resolveLayerProps(retitled, "main", instance, mockRegistry)!.find((p) => p.key === "title")?.type).toBe("number");
    expect(resolveLayerProps(retitled, "main", { type: "componentInstance", component: "missing" }, mockRegistry)).toBe(resolveLayerProps(doc, "main", { type: "componentInstance" }, mockRegistry));
  });
});

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

  it("resolves an explicit typeParam; other variants start at their zero value", () => {
    const ports = resolveNodePorts(doc, node("transition", { typeParam: "color" }), mockRegistry)!;
    expect(ports.inputs[1]).toMatchObject({ key: "start", type: "color", default: "#00000000" });
    expect(ports.inputs[2]).toMatchObject({ key: "end", type: "color", default: "#00000000" });
    expect(ports.variants).toEqual(["number", "point", "color"]);
    expect(resolveNodePorts(doc, node("transition"), mockRegistry)!.inputs.map((p) => p.default)).toEqual([0, 0, 1]);
    const bad = resolveNodePorts(doc, node("transition", { typeParam: "sound" }), mockRegistry)!;
    expect(bad.typeParam).toBe("number");
  });

  it("applies variantDefaults and never converts loop literals", () => {
    const defaults = (typeParam?: string) => {
      const ports = resolveNodePorts(doc, node("blend", typeParam ? { typeParam } : {}), extendedRegistry)!;
      return Object.fromEntries(ports.inputs.map((p) => [p.key, p.default]));
    };
    expect(defaults()).toEqual({ progress: 0, start: 0, end: 1, points: { loop: [0, 100] } });
    expect(defaults("color")).toEqual({ progress: 0, start: "#FFFFFFFF", end: "#00000000", points: { loop: [0, 100] } });
    expect(defaults("point")).toEqual({ progress: 0, start: [0, 0], end: [0, 0], points: { loop: [0, 100] } });
    expect(resolveNodePorts(doc, node("blend", { typeParam: "point" }), extendedRegistry)!.outputs[0]).not.toHaveProperty("default");
  });

  it("expands variadic ports from startIndex, on the side named by direction", () => {
    const picker = resolveNodePorts(doc, node("picker", { inputCount: 3, typeParam: "color" }), extendedRegistry)!;
    expect(picker.inputs.map((p) => `${p.key}:${p.type}:${p.name}:${p.variadicIndex ?? "-"}`)).toEqual(["option:index:Option:-", "option0:color:Option 0:1", "option1:color:Option 1:2", "option2:color:Option 2:3"]);
    expect(picker.inputs.map((p) => p.default)).toEqual([0, "#FFFFFFFF", "#FFFFFFFF", "#FFFFFFFF"]);
    expect(resolveNodePorts(doc, node("picker", { typeParam: "text" }), extendedRegistry)!.inputs.map((p) => p.default)).toEqual([0, "", ""]);
    const sender = resolveNodePorts(doc, node("sender", { inputCount: 2 }), extendedRegistry)!;
    expect(sender.inputs.map((p) => p.key)).toEqual(["option", "value"]);
    expect(sender.outputs.map((p) => `${p.key}:${p.variadicIndex ?? "-"}`)).toEqual(["selected:-", "option0:1", "option1:2"]);
  });

  it("clamps inputCount with inputCountRange for repeated groups outside VariadicSpec", () => {
    const stops = extendedRegistry.patches.get("stops")!;
    expect(getInputCountRange(stops)).toEqual({ min: 1, max: 4, defaultCount: 2 });
    expect(getInputCountRange(mockRegistry.patches.get("add")!)).toEqual({ min: 2, max: 6, defaultCount: 2 });
    expect(getInputCountRange(mockRegistry.patches.get("switch")!)).toBeUndefined();
    expect([resolveInputCount(stops, undefined), resolveInputCount(stops, 0), resolveInputCount(stops, 3.4), resolveInputCount(stops, 99)]).toEqual([2, 1, 3, 4]);
    const ports = resolveNodePorts(doc, node("stops", { inputCount: 9 }), extendedRegistry)!;
    expect(ports.inputCount).toBe(4);
    expect(ports.inputs.map((p) => p.key)).toEqual(["stop1", "stop2", "stop3", "stop4"]);
    expect(resolveNodePorts(doc, node("switch", { inputCount: 3 }), mockRegistry)!.inputCount).toBeUndefined();
  });

  it("lets dynamicPorts declare a node's variants", () => {
    const script = node("script", { typeParam: "color", settings: { variants: ["text", "color", "sparkle"] } });
    const ports = resolveNodePorts(doc, script, extendedRegistry)!;
    expect(ports.variants).toEqual(["text", "color"]);
    expect(ports.typeParam).toBe("color");
    expect(ports.outputs[0]!.type).toBe("color");
    expect(resolveNodeVariants(doc, script, extendedRegistry)).toEqual(["text", "color"]);
    const undeclared = resolveNodePorts(doc, node("script", { typeParam: "color" }), extendedRegistry)!;
    expect([undeclared.typeParam, undeclared.variants, undeclared.outputs[0]!.type]).toEqual([undefined, undefined, "any"]);
    const spec = extendedRegistry.patches.get("script")!;
    expect(resolveTypeParam(spec, "number", ["text", "number"])).toBe("number");
    expect(resolveTypeParam(spec, "point", ["text", "number"])).toBe("text");
    expect(resolveTypeParam(mockRegistry.patches.get("transition")!, "color", [])).toBe("color");
    const junk = createRegistry([{ type: "junk", name: "Junk", category: "utility", summary: "Returns nothing useful.", inputs: [port("a", "number")], outputs: [], dynamicPorts: () => ({}) as never }]);
    expect(resolveNodePorts(doc, node("junk"), junk)!.inputs.map((p) => p.key)).toEqual(["a"]);
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
