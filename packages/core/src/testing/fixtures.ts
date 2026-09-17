/** Test fixtures: mock patch specs (the real library lives in @sonobe/patches) and a sample document. */

import { expect } from "vitest";
import { createEmptyDocument } from "../document.ts";
import { applyOps, type ApplyOpsOptions, type ApplyOpsResult } from "../ops/index.ts";
import { createRegistry } from "../registry.ts";
import type { Op, PatchSpec, PortSpec, SonobeDocument, ValueType } from "../types.ts";

export function port(key: string, type: ValueType | "variant", extra: Partial<PortSpec> = {}): PortSpec {
  const name = key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  return { key, name, type, description: `The ${name.toLowerCase()} port.`, ...extra };
}

export const MOCK_PATCH_SPECS: PatchSpec[] = [
  {
    type: "interaction",
    name: "Interaction",
    category: "interaction",
    aliases: ["tap", "touch", "press"],
    summary: "Detects taps and presses on a layer.",
    inputs: [port("layer", "layer"), port("enabled", "boolean", { default: true })],
    outputs: [port("down", "boolean"), port("tap", "pulse"), port("position", "point")],
  },
  {
    type: "switch",
    name: "Switch",
    category: "state",
    aliases: ["toggle", "flip flop"],
    summary: "Holds on/off state that pulses flip, turn on, or turn off.",
    inputs: [port("flip", "pulse"), port("turnOn", "pulse"), port("turnOff", "pulse")],
    outputs: [port("on", "boolean")],
  },
  {
    type: "counter",
    name: "Counter",
    category: "state",
    summary: "Counts pulses.",
    inputs: [port("increase", "pulse"), port("decrease", "pulse")],
    outputs: [port("count", "number")],
  },
  {
    type: "popAnimation",
    name: "Pop Animation",
    category: "animation",
    aliases: ["spring", "bouncy", "pop"],
    summary: "Springs toward a target number.",
    inputs: [port("number", "number", { default: 0 }), port("bounciness", "number", { default: 5, min: 0 }), port("speed", "number", { default: 10, min: 0 })],
    outputs: [port("output", "number")],
  },
  {
    type: "transition",
    name: "Transition",
    category: "animation",
    summary: "Maps progress 0..1 onto a range.",
    variants: ["number", "point", "color"],
    inputs: [port("progress", "number", { default: 0 }), port("start", "variant", { default: 0 }), port("end", "variant", { default: 1 })],
    outputs: [port("output", "variant")],
  },
  {
    type: "add",
    name: "Add",
    category: "math",
    summary: "Adds values.",
    variants: ["number", "point"],
    variadic: { key: "value", name: "Value", type: "variant", default: 0, min: 2, max: 6, defaultCount: 2, description: "A value to add." },
    inputs: [],
    outputs: [port("output", "variant")],
  },
  {
    type: "delay1",
    name: "Delay 1",
    category: "utility",
    summary: "Outputs last frame's value.",
    inputs: [port("value", "any")],
    outputs: [port("output", "any")],
  },
  {
    type: "hexColor",
    name: "Hex Color",
    category: "color",
    summary: "Parses hex text into a color.",
    inputs: [port("hex", "text", { default: "#FFFFFFFF" })],
    outputs: [port("color", "color")],
  },
  {
    type: "logger",
    name: "Logger",
    category: "utility",
    summary: "Logs values.",
    inputs: [port("value", "any")],
    outputs: [],
  },
  {
    type: "javascript",
    name: "JavaScript",
    category: "scripting",
    summary: "Runs a script with declared ports.",
    inputs: [],
    outputs: [],
    dynamicPorts: (node) => {
      if (node.settings?.broken) throw new Error("The script has a syntax error.");
      const ports = (node.settings?.ports ?? {}) as { inputs?: [string, ValueType][]; outputs?: [string, ValueType][] };
      return { inputs: (ports.inputs ?? []).map(([k, t]) => port(k, t)), outputs: (ports.outputs ?? []).map(([k, t]) => port(k, t)) };
    },
  },
];

export const mockRegistry = createRegistry(MOCK_PATCH_SPECS);

/**
 * Specs for contract features the core mocks don't exercise: variantDefaults and loop-literal
 * defaults, 0-based and output-side variadics, inputCountRange, variants declared by dynamicPorts,
 * and state inputs that take pulses (logic merges, acceptsPulse).
 */
export const EXTRA_PATCH_SPECS: PatchSpec[] = [
  {
    type: "blend",
    name: "Blend",
    category: "animation",
    summary: "Blends between two values.",
    variants: ["number", "color", "point"],
    inputs: [port("progress", "number", { default: 0 }), port("start", "variant", { default: 0 }), port("end", "variant", { default: 1 }), port("points", "variant", { default: { loop: [0, 100] }, wholeLoop: true })],
    outputs: [port("output", "variant")],
    variantDefaults: { color: { start: "#FFFFFFFF" } },
  },
  {
    type: "picker",
    name: "Option Picker",
    category: "state",
    summary: "Outputs the option at an index.",
    variants: ["number", "text", "color"],
    inputs: [port("option", "index", { default: 0 })],
    outputs: [port("output", "variant")],
    variadic: { key: "option", name: "Option", type: "variant", default: 0, min: 2, max: 6, defaultCount: 2, startIndex: 0, description: "An option to pick." },
    variantDefaults: { color: { option: "#FFFFFFFF" } },
  },
  {
    type: "sender",
    name: "Option Sender",
    category: "state",
    summary: "Sends a value to the selected option's output.",
    variants: ["number", "text"],
    inputs: [port("option", "index", { default: 0 }), port("value", "variant", { default: 1 })],
    outputs: [port("selected", "index")],
    variadic: { key: "option", name: "Option", type: "variant", default: 0, min: 2, max: 6, defaultCount: 3, startIndex: 0, direction: "outputs", description: "The value while this option is selected." },
  },
  {
    type: "stops",
    name: "Gradient Builder",
    category: "color",
    summary: "Builds a gradient from stops.",
    inputs: [],
    outputs: [port("gradient", "gradient")],
    inputCountRange: { min: 1, max: 4, defaultCount: 2 },
    dynamicPorts: (node) => {
      const n = Math.min(4, Math.max(1, Math.round(node.inputCount ?? 2)));
      const keys = Array.from({ length: n }, (_, i) => i + 1);
      return { inputs: keys.map((k) => port(`stop${k}`, "number", { default: 0 })), outputs: keys.map((k) => port(`at${k}`, "number")) };
    },
  },
  {
    type: "script",
    name: "Script",
    category: "scripting",
    summary: "A script that declares its own types.",
    inputs: [],
    outputs: [],
    dynamicPorts: (node) => ({ inputs: [port("value", "variant")], outputs: [port("output", "variant")], variants: (node.settings?.variants ?? []) as ValueType[] }),
  },
  {
    type: "or",
    name: "Or",
    category: "logic",
    summary: "On when any input is on.",
    inputs: [],
    outputs: [port("output", "boolean")],
    variadic: { key: "value", name: "Value", type: "boolean", default: false, min: 2, max: 8, defaultCount: 2, description: "An on/off value." },
  },
  {
    type: "roundDown",
    name: "Round Down",
    category: "logic",
    summary: "Rounds a number down.",
    inputs: [port("amount", "number", { default: 0 })],
    outputs: [port("output", "number")],
  },
  {
    type: "sampler",
    name: "Sample and Hold",
    category: "state",
    summary: "Captures a value while Sample is on.",
    inputs: [port("value", "number", { default: 0 }), port("sample", "boolean", { default: false, acceptsPulse: true })],
    outputs: [port("output", "number")],
  },
];

export const extendedRegistry = createRegistry([...MOCK_PATCH_SPECS, ...EXTRA_PATCH_SPECS]);

export function emptyDoc(): SonobeDocument {
  return createEmptyDocument({ name: "Test", device: "custom" });
}

export function mustApply(doc: SonobeDocument, ops: Op[], options: Partial<ApplyOpsOptions> = {}): ApplyOpsResult {
  const r = applyOps(doc, ops, { registry: mockRegistry, ...options });
  if (!r.ok) throw new Error(`applyOps failed:\n${JSON.stringify(r.errors, null, 2)}`);
  return r;
}

/** Applying the inverse to the result restores a deep-equal document; re-applying `applied` reproduces the result. */
export function expectRoundTrip(before: SonobeDocument, result: ApplyOpsResult, options: Partial<ApplyOpsOptions> = {}): void {
  const undo = applyOps(result.doc, result.inverse, { registry: mockRegistry, ...options });
  if (!undo.ok) throw new Error(`inverse failed:\n${JSON.stringify(undo.errors, null, 2)}\ninverse: ${JSON.stringify(result.inverse, null, 2)}`);
  expect(undo.doc).toStrictEqual(before);
  const redo = applyOps(before, result.applied, { registry: mockRegistry, ...options });
  if (!redo.ok) throw new Error(`redo failed:\n${JSON.stringify(redo.errors, null, 2)}`);
  expect(redo.doc).toStrictEqual(result.doc);
}

/** The tap-to-grow card from ARCHITECTURE §3.3 (with the card as a group so it can hold a title). */
export const SAMPLE_OPS: Op[] = [
  {
    op: "addLayer",
    layer: {
      ref: "card",
      type: "group",
      name: "Card",
      props: { position: [16, 120], size: [358, 220], cornerRadius: 24, color: "#FFFFFFFF" },
      children: [{ type: "text", name: "Title", props: { text: "Popular Events" } }],
    },
  },
  { op: "addPatch", patch: { id: "tap_card", type: "interaction", inputs: { layer: { layer: "$card" } } } },
  { op: "addPatch", patch: { ref: "toggle", id: "toggle", type: "switch", name: "", inputs: { flip: { link: "tap_card.tap" } } } },
  { op: "addPatch", patch: { id: "pop", type: "popAnimation", inputs: { number: { link: "$toggle.on" }, bounciness: 8, speed: 10 } } },
  { op: "addPatch", patch: { id: "grow", type: "transition", typeParam: "number", inputs: { progress: { link: "pop.output" }, start: 1, end: 1.08 } } },
  { op: "setInput", target: "@$card.scale", value: { link: "grow.output" } },
  { op: "addComment", comment: { id: "note_1", text: "Spring feel matches iOS sheet", rect: [30, 20, 600, 120], color: "yellow" } },
];

export function buildSampleDocument(): SonobeDocument {
  return mustApply(emptyDoc(), SAMPLE_OPS).doc;
}
