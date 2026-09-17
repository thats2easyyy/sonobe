import { LAYER_TYPES, applyOps, resolveNodePorts } from "@sonobe/core";
import type { ComponentKind, SonobeDocument } from "@sonobe/core";
import type { PatchDefinition } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import { definePatch } from "./infra/definePatch.ts";
import { createPatchHarness } from "./infra/harness.ts";
import { loopOf } from "./infra/loops.ts";
import {
  CATEGORY_DEFINITIONS,
  builtinDefinitions,
  createFallbackDefinition,
  createPatchRegistry,
  isFallbackDefinition,
  unimplementedMessage,
} from "./registry.ts";
import { PATCH_TYPES, SPECS, hasSpec } from "./specs.ts";

function testDocument(): SonobeDocument {
  const component = (id: string, kind: ComponentKind) => ({
    formatVersion: 1,
    id,
    name: id,
    kind,
    interface: { inputs: {}, outputs: {} },
    layers: [],
    patches: {},
    comments: [],
  });
  const doc: SonobeDocument = {
    project: { formatVersion: 1, name: "Test", root: "main", device: { preset: "iphone-17-pro" } },
    components: { main: component("main", "prototype"), button: component("button", "patchComponent") },
    scripts: {},
    assets: {},
  };
  doc.components.button!.interface.inputs.pressed = { key: "pressed", name: "Pressed", type: "boolean" };
  doc.components.button!.interface.outputs.scale = { key: "scale", name: "Scale", type: "number" };
  return doc;
}

describe("createPatchRegistry", () => {
  it("registers every catalog spec with a definition, plus core layer types", () => {
    const registry = createPatchRegistry();
    expect([...registry.patches.keys()]).toEqual(PATCH_TYPES);
    expect([...registry.definitions.keys()]).toEqual(PATCH_TYPES);
    expect(registry.layers.size).toBe(LAYER_TYPES.length);
    for (const type of PATCH_TYPES) {
      const def = registry.definitions.get(type)!;
      expect(registry.patches.get(type), type).toBe(def);
      expect(def.inputs, type).toEqual(SPECS[type]!.inputs);
      expect(typeof def.evaluate, type).toBe("function");
    }
  });

  it("splits implemented and unimplemented types", () => {
    const registry = createPatchRegistry();
    const implemented = registry.listImplemented();
    const unimplemented = registry.listUnimplemented();
    expect([...implemented, ...unimplemented].sort()).toEqual([...PATCH_TYPES].sort());
    expect([...implemented].sort()).toEqual(builtinDefinitions().map((d) => d.type).sort());
    for (const type of unimplemented) expect(isFallbackDefinition(registry.definitions.get(type)), type).toBe(true);
    for (const type of implemented) expect(registry.isImplemented(type), type).toBe(true);
  });

  it("keeps built-in definitions in their catalog category module", () => {
    const problems: string[] = [];
    for (const [category, defs] of Object.entries(CATEGORY_DEFINITIONS)) {
      for (const def of defs) {
        if (!hasSpec(def.type)) problems.push(`${category}/: "${def.type}" isn't a catalog type`);
        else if (def.category !== category) problems.push(`${category}/: "${def.type}" belongs in ${def.category}/`);
        if (typeof def.evaluate !== "function") problems.push(`${category}/: "${def.type}" has no evaluate`);
      }
    }
    expect(problems).toEqual([]);
    expect(() => builtinDefinitions()).not.toThrow();
  });

  it("uses supplied definitions in place of built-ins and fallbacks", () => {
    const def = definePatch("switch", { evaluate() {} });
    const registry = createPatchRegistry({ definitions: [def] });
    expect(registry.definitions.get("switch")).toBe(def);
    expect(registry.patches.get("switch")).toBe(def);
    expect(registry.isImplemented("switch")).toBe(true);
    expect(registry.listImplemented()).toContain("switch");
    expect(registry.listUnimplemented()).not.toContain("switch");
  });

  it("accepts definitions for types outside the catalog", () => {
    const custom: PatchDefinition = { type: "myGlow", name: "My Glow", category: "layers", summary: "Glows.", inputs: [], outputs: [], evaluate() {} };
    const registry = createPatchRegistry({ definitions: [custom] });
    expect(registry.patches.get("myGlow")).toBe(custom);
    expect(registry.isImplemented("myGlow")).toBe(true);
    expect([...registry.patches.keys()].at(-1)).toBe("myGlow");
  });

  it("can leave unimplemented types without definitions", () => {
    const registry = createPatchRegistry({ fallbacks: false });
    expect(registry.patches.size).toBe(PATCH_TYPES.length);
    expect(registry.definitions.size).toBe(builtinDefinitions().length);
    expect(registry.listImplemented().length + registry.listUnimplemented().length).toBe(PATCH_TYPES.length);
  });

  it("resolves ports through core, including component interfaces", () => {
    const registry = createPatchRegistry();
    const doc = testDocument();
    const ui = { x: 0, y: 0 };
    expect(resolveNodePorts(doc, { type: "transition", typeParam: "color", inputs: {}, ui }, registry)?.outputs.map((p) => p.type)).toEqual(["color"]);
    const instance = resolveNodePorts(doc, { type: "component", component: "button", inputs: {}, ui }, registry)!;
    expect(instance.inputs.map((p) => p.key)).toContain("pressed");
    expect(instance.outputs.map((p) => p.key)).toContain("scale");
  });

  it("validates ops against catalog specs", () => {
    const registry = createPatchRegistry();
    const result = applyOps(
      testDocument(),
      [
        { op: "addPatch", patch: { id: "toggle", type: "switch" } },
        { op: "addPatch", patch: { id: "pop", type: "popAnimation", inputs: { bounciness: 8 } } },
        { op: "addPatch", patch: { id: "fade", type: "transition", typeParam: "color" } },
        { op: "connect", from: "toggle.on", to: "pop.number" },
        { op: "connect", from: "pop.output", to: "fade.progress" },
      ],
      { registry },
    );
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    const typo = applyOps(testDocument(), [{ op: "addPatch", patch: { id: "p", type: "popAnimaton" } }], { registry });
    expect(typo.ok).toBe(false);
  });
});

describe("fallback definitions", () => {
  it("outputs zero values, never pulses, and warns once per restart", () => {
    const def = createFallbackDefinition(SPECS.interaction!);
    expect(isFallbackDefinition(def)).toBe(true);
    expect(isFallbackDefinition(definePatch("interaction", { evaluate() {} }))).toBe(false);
    const h = createPatchHarness(def);
    h.run(3);
    expect(h.output("down")).toBe(false);
    expect(h.output("position")).toEqual([0, 0]);
    expect(h.output("force")).toBe(0);
    expect(h.pulsed("tap")).toBe(false);
    expect(h.logs.map((l) => [l.level, l.message])).toEqual([["warn", "Interaction isn't implemented yet, so it outputs default values for now."]]);
    h.restart();
    h.step();
    expect(h.logs).toHaveLength(2);
    expect(unimplementedMessage({ name: "Pop Animation" })).toMatch(/^Pop Animation isn't implemented yet/);
  });

  it("follows the variant, whole-loop outputs, and variadic outputs", () => {
    expect(createPatchHarness(createFallbackDefinition(SPECS.popAnimation!), { typeParam: "color" }).step().outputs.output).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(createPatchHarness(createFallbackDefinition(SPECS.loopBuilder!)).step().outputs).toEqual({ loop: loopOf([]), index: loopOf([]) });
    const sender = createPatchHarness(createFallbackDefinition(SPECS.optionSender!), { typeParam: "boolean", inputCount: 3 }).step().outputs;
    expect(sender).toEqual({ option0: false, option1: false, option2: false });
  });

  it("gives every catalog patch a runnable fallback", () => {
    const problems: string[] = [];
    for (const spec of Object.values(SPECS)) {
      try {
        const frame = createPatchHarness(createFallbackDefinition(spec)).step();
        for (const port of spec.outputs) if (port.type !== "pulse" && !(port.key in frame.outputs)) problems.push(`${spec.type}.${port.key}: no output`);
        if (frame.pulses.size) problems.push(`${spec.type}: fired a pulse`);
      } catch (err) {
        problems.push(`${spec.type}: ${(err as Error).message}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
