/**
 * Patch types the engine evaluates natively because their semantics live in the graph compiler:
 * `component` (inlined instances), `delay1` (the feedback register), and the variable pair
 * (compiled to implicit edges). Specs here are fallbacks used when a registry doesn't declare them;
 * a registry spec with the same type wins.
 */

import { COMPONENT_PATCH_SPEC, createRegistry, type LayerTypeSpec, type PatchSpec, type ValueType } from "@sonobe/core";
import type { EngineRegistry, PatchDefinition } from "../types.ts";

export const DELAY1_TYPE = "delay1";
export const VARIABLE_BROADCASTER_TYPE = "variableBroadcaster";
export const VARIABLE_RECEIVER_TYPE = "variableReceiver";

/** The VALUE variant set (CONVENTIONS.md §8) used by delay1 and variables. */
export const VALUE_VARIANTS: ValueType[] = [
  "number", "boolean", "text", "color", "point", "point3d", "point4d", "size", "anchor", "index", "enum", "json",
  "image", "video", "sound", "gradient", "shape", "layerEffect", "layer",
];

const variableSettings: PatchSpec["settings"] = [
  { key: "name", name: "Name", type: "text", default: "", description: "The variable's name." },
  {
    key: "scope",
    name: "Scope",
    type: "enum",
    default: "local",
    enumOptions: [
      { key: "local", name: "Local" },
      { key: "global", name: "Global" },
    ],
    description: "Local reaches this patch graph; Global also reaches nested components.",
  },
];

/** Fallback specs for natively evaluated patch types. */
export const BUILTIN_PATCH_SPECS: readonly PatchSpec[] = [
  {
    type: DELAY1_TYPE,
    name: "Delay One Frame",
    category: "state",
    summary: "Outputs the value it received on the previous frame.",
    variants: VALUE_VARIANTS,
    inputs: [{ key: "value", name: "Value", type: "variant", default: 0, description: "The value to delay." }],
    outputs: [{ key: "output", name: "Output", type: "variant", description: "Last frame's value." }],
  },
  {
    type: VARIABLE_BROADCASTER_TYPE,
    name: "Variable Broadcaster",
    category: "utility",
    summary: "Sends a value to every Variable Receiver with the same name.",
    variants: VALUE_VARIANTS,
    settings: variableSettings,
    inputs: [{ key: "value", name: "Value", type: "variant", default: 0, description: "The value to share." }],
    outputs: [],
  },
  {
    type: VARIABLE_RECEIVER_TYPE,
    name: "Variable Receiver",
    category: "utility",
    summary: "Outputs the value of the Variable Broadcaster with the same name.",
    variants: VALUE_VARIANTS,
    settings: variableSettings,
    inputs: [],
    outputs: [{ key: "output", name: "Output", type: "variant", description: "The shared value." }],
  },
];

/** Types whose evaluation the engine owns (definitions registered for them only supply specs). */
export const NATIVE_PATCH_TYPES: ReadonlySet<string> = new Set([
  COMPONENT_PATCH_SPEC.type,
  DELAY1_TYPE,
  VARIABLE_BROADCASTER_TYPE,
  VARIABLE_RECEIVER_TYPE,
]);

/**
 * Build an EngineRegistry from patch definitions (plus optional spec-only entries and layer types).
 * Built-in fallback specs fill in delay1 and the variable pair when not declared.
 */
export function createEngineRegistry(
  definitions: Iterable<PatchDefinition>,
  options: { specs?: Iterable<PatchSpec>; layerTypes?: Iterable<LayerTypeSpec> } = {},
): EngineRegistry {
  const defs = [...definitions];
  const specs = new Map<string, PatchSpec>();
  for (const spec of options.specs ?? []) specs.set(spec.type, spec);
  for (const def of defs) specs.set(def.type, def);
  for (const spec of BUILTIN_PATCH_SPECS) if (!specs.has(spec.type)) specs.set(spec.type, spec);
  const base = options.layerTypes ? createRegistry(specs.values(), options.layerTypes) : createRegistry(specs.values());
  return { ...base, definitions: new Map(defs.map((d) => [d.type, d])) };
}

/** The registry the compiler resolves against: the caller's, with builtin fallback specs added. */
export function withBuiltinSpecs(registry: EngineRegistry): EngineRegistry {
  let missing = false;
  for (const spec of BUILTIN_PATCH_SPECS) if (!registry.patches.has(spec.type)) missing = true;
  if (!missing) return registry;
  const patches = new Map(registry.patches);
  for (const spec of BUILTIN_PATCH_SPECS) if (!patches.has(spec.type)) patches.set(spec.type, spec);
  return { patches, layers: registry.layers, definitions: registry.definitions };
}
