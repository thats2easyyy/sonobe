/**
 * The patch registry: every catalog spec plus the evaluators the category modules define.
 * Catalog types nobody has implemented yet get a fallback definition that outputs zero values and
 * says so once, so every document loads, validates, and runs.
 */

import { COMPONENT_PATCH_SPEC, COMPONENT_PATCH_TYPE, LAYER_TYPES, createRegistry } from "@sonobe/core";
import type { LayerTypeSpec, PatchCategory, PatchSpec } from "@sonobe/core";
import type { EngineRegistry, PatchDefinition } from "@sonobe/engine";
import { definitions as animation } from "./animation/index.ts";
import { definitions as color } from "./color/index.ts";
import { definitions as components } from "./components/index.ts";
import { definitions as data } from "./data/index.ts";
import { definitions as device } from "./device/index.ts";
import { loopOf } from "./infra/loops.ts";
import { nodePorts } from "./infra/ports.ts";
import { zeroValue } from "./infra/values.ts";
import { warnOnce } from "./infra/warn.ts";
import { definitions as interaction } from "./interaction/index.ts";
import { definitions as layers } from "./layers/index.ts";
import { definitions as logic } from "./logic/index.ts";
import { definitions as loops } from "./loops/index.ts";
import { definitions as math } from "./math/index.ts";
import { definitions as media } from "./media/index.ts";
import { definitions as scripting } from "./scripting/index.ts";
import { definitions as shapes } from "./shapes/index.ts";
import { PATCH_TYPES, getSpec, hasSpec } from "./specs.ts";
import { definitions as state } from "./state/index.ts";
import { definitions as text } from "./text/index.ts";
import { definitions as utility } from "./utility/index.ts";

/** Built-in definitions by category module. */
export const CATEGORY_DEFINITIONS: Readonly<Record<PatchCategory, readonly PatchDefinition[]>> = {
  interaction,
  animation,
  state,
  logic,
  math,
  loops,
  text,
  color,
  data,
  device,
  media,
  shapes,
  layers,
  utility,
  components,
  scripting,
};

export interface PatchRegistryOptions {
  /** Extra definitions (plugins, tests). They replace built-ins of the same type. */
  definitions?: Iterable<PatchDefinition>;
  /** Layer types (default: core LAYER_TYPES). */
  layerTypes?: Iterable<LayerTypeSpec>;
  /** Give unimplemented catalog types a fallback definition (default true). */
  fallbacks?: boolean;
}

export interface PatchRegistry extends EngineRegistry {
  /** True when `type` has a real evaluator (not a fallback). */
  isImplemented(type: string): boolean;
  /** Types with real evaluators, in catalog order. */
  listImplemented(): string[];
  /** Types without real evaluators (fallback or none), in catalog order. */
  listUnimplemented(): string[];
}

const fallbackDefinitions = new WeakSet<PatchDefinition>();

/** True for definitions made by {@link createFallbackDefinition}. */
export function isFallbackDefinition(definition: PatchDefinition | undefined): boolean {
  return definition !== undefined && fallbackDefinitions.has(definition);
}

/** The once-per-restart warning an unimplemented patch logs. */
export function unimplementedMessage(spec: Pick<PatchSpec, "name">): string {
  return `${spec.name} isn't implemented yet, so it outputs default values for now.`;
}

/**
 * A definition for a patch nobody has implemented: every non-pulse output emits its zero value
 * (whole-loop outputs an empty loop), pulses never fire, and one warning is logged per restart.
 */
export function createFallbackDefinition(spec: PatchSpec): PatchDefinition {
  const definition: PatchDefinition = {
    ...spec,
    evaluate(ctx) {
      warnOnce(ctx, "unimplemented", unimplementedMessage(spec));
      for (const port of nodePorts(spec, ctx.typeParam, ctx.inputCount).outputs) {
        if (port.type === "pulse") continue;
        ctx.output(port.key, port.wholeLoop ? loopOf([]) : zeroValue(port.type, port.enumOptions));
      }
    },
  };
  fallbackDefinitions.add(definition);
  return definition;
}

/** Component instances keep core's interface-derived ports unless a definition supplies its own. */
function withComponentPorts<T extends PatchSpec>(spec: T): T {
  return spec.type === COMPONENT_PATCH_TYPE && !spec.dynamicPorts ? { ...spec, dynamicPorts: COMPONENT_PATCH_SPEC.dynamicPorts } : spec;
}

/** Every built-in definition in category order. Throws when two modules define the same type. */
export function builtinDefinitions(): PatchDefinition[] {
  const where = new Map<string, string>();
  const out: PatchDefinition[] = [];
  for (const [category, defs] of Object.entries(CATEGORY_DEFINITIONS)) {
    for (const def of defs) {
      const previous = where.get(def.type);
      if (previous !== undefined) throw new Error(`Patch "${def.type}" is defined twice (in ${previous}/ and ${category}/).`);
      where.set(def.type, category);
      out.push(def);
    }
  }
  return out;
}

/**
 * Build the engine registry: a core Registry with every catalog spec (implemented definitions
 * stand in for their specs) plus the definitions map, with fallbacks for unimplemented types.
 */
export function createPatchRegistry(options: PatchRegistryOptions = {}): PatchRegistry {
  const implemented = new Map<string, PatchDefinition>();
  for (const def of builtinDefinitions()) implemented.set(def.type, def);
  for (const def of options.definitions ?? []) implemented.set(def.type, def);
  const fallbacks = options.fallbacks ?? true;

  const specs: PatchSpec[] = [];
  const definitions = new Map<string, PatchDefinition>();
  const add = (spec: PatchSpec, definition: PatchDefinition | undefined) => {
    specs.push(definition ?? spec);
    if (definition) definitions.set(spec.type, definition);
  };
  for (const type of PATCH_TYPES) {
    const spec = withComponentPorts(getSpec(type)!);
    const def = implemented.get(type);
    add(spec, def ? withComponentPorts(def) : fallbacks ? createFallbackDefinition(spec) : undefined);
  }
  for (const [type, def] of implemented) if (!hasSpec(type)) add(def, withComponentPorts(def));

  const { patches, layers: layerTypes } = createRegistry(specs, options.layerTypes ?? LAYER_TYPES);
  const isImplemented = (type: string) => {
    const def = definitions.get(type);
    return def !== undefined && !fallbackDefinitions.has(def);
  };
  return {
    patches,
    layers: layerTypes,
    definitions,
    isImplemented,
    listImplemented: () => [...patches.keys()].filter(isImplemented),
    listUnimplemented: () => [...patches.keys()].filter((type) => !isImplemented(type)),
  };
}
