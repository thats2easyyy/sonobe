/**
 * The built-in patch catalog as contract specs. Every chunk in `../catalog` is imported as
 * JSON, so catalog edits take effect with no code generation. Catalog-only fields
 * (CONVENTIONS.md §3.1 ◆: behavior, importAliases, origamiPorts, defaultNotes,
 * dynamicPortsRule) are split into BEHAVIORS; everything else is a PatchSpec.
 */

import type { PatchCategory, PatchSpec } from "@sonobe/core";
import interaction1 from "../catalog/interaction-1.json" with { type: "json" };
import interaction2 from "../catalog/interaction-2.json" with { type: "json" };
import animation1 from "../catalog/animation-1.json" with { type: "json" };
import animation2 from "../catalog/animation-2.json" with { type: "json" };
import state1 from "../catalog/state-1.json" with { type: "json" };
import state2 from "../catalog/state-2.json" with { type: "json" };
import logic1 from "../catalog/logic-1.json" with { type: "json" };
import math1 from "../catalog/math-1.json" with { type: "json" };
import math2 from "../catalog/math-2.json" with { type: "json" };
import loops1 from "../catalog/loops-1.json" with { type: "json" };
import loops2 from "../catalog/loops-2.json" with { type: "json" };
import text1 from "../catalog/text-1.json" with { type: "json" };
import color1 from "../catalog/color-1.json" with { type: "json" };
import data1 from "../catalog/data-1.json" with { type: "json" };
import data2 from "../catalog/data-2.json" with { type: "json" };
import device1 from "../catalog/device-1.json" with { type: "json" };
import media1 from "../catalog/media-1.json" with { type: "json" };
import shapes1 from "../catalog/shapes-1.json" with { type: "json" };
import layers1 from "../catalog/layers-1.json" with { type: "json" };
import utility1 from "../catalog/utility-1.json" with { type: "json" };
import utility2 from "../catalog/utility-2.json" with { type: "json" };
import components1 from "../catalog/components-1.json" with { type: "json" };
import scripting1 from "../catalog/scripting-1.json" with { type: "json" };

/** Catalog-only text for a patch: the implementer spec and import mappings. */
export interface PatchBehavior {
  /** Evaluation spec for implementers (CONVENTIONS.md §16). */
  behavior: string;
  /** Other Origami identifiers that import as this patch. */
  importAliases?: string[];
  /** Sonobe port key → Origami port label, for renamed or merged ports. */
  origamiPorts?: Record<string, string>;
  /** Port key → where an unverified default came from ("sonobe: …", "legacy: …"). */
  defaultNotes?: Record<string, string>;
  /** Plain-language derivation for patches whose ports depend on the node or document. */
  dynamicPortsRule?: string;
}

/** A catalog entry as written in a chunk file: a PatchSpec plus the catalog-only fields. */
export type CatalogEntry = Omit<PatchSpec, "dynamicPorts"> & PatchBehavior;

export interface CatalogChunk {
  file: string;
  category: PatchCategory;
  patches: CatalogEntry[];
}

const CATALOG_ONLY_FIELDS: ReadonlySet<string> = new Set(["behavior", "importAliases", "origamiPorts", "defaultNotes", "dynamicPortsRule"]);

const asChunk = (raw: unknown): CatalogChunk => raw as CatalogChunk;

/** Every chunk file, in index.json order. A new chunk file needs an import here (a test checks). */
export const CATALOG_CHUNKS: readonly CatalogChunk[] = [
  asChunk(interaction1),
  asChunk(interaction2),
  asChunk(animation1),
  asChunk(animation2),
  asChunk(state1),
  asChunk(state2),
  asChunk(logic1),
  asChunk(math1),
  asChunk(math2),
  asChunk(loops1),
  asChunk(loops2),
  asChunk(text1),
  asChunk(color1),
  asChunk(data1),
  asChunk(data2),
  asChunk(device1),
  asChunk(media1),
  asChunk(shapes1),
  asChunk(layers1),
  asChunk(utility1),
  asChunk(utility2),
  asChunk(components1),
  asChunk(scripting1),
];

/** File names of the imported chunks. */
export const CATALOG_FILES: readonly string[] = CATALOG_CHUNKS.map((c) => c.file);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Strip catalog-only fields. `origami: null` (Sonobe-native) is omitted, as CONVENTIONS.md §3.1 asks. */
function toSpec(entry: CatalogEntry): PatchSpec {
  const spec: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (CATALOG_ONLY_FIELDS.has(key)) continue;
    if (key === "origami" && value === null) continue;
    spec[key] = value;
  }
  return spec as unknown as PatchSpec;
}

function toBehavior(entry: CatalogEntry): PatchBehavior {
  const out: PatchBehavior = { behavior: entry.behavior ?? "" };
  if (entry.importAliases !== undefined) out.importAliases = entry.importAliases;
  if (entry.origamiPorts !== undefined) out.origamiPorts = entry.origamiPorts;
  if (entry.defaultNotes !== undefined) out.defaultNotes = entry.defaultNotes;
  if (entry.dynamicPortsRule !== undefined) out.dynamicPortsRule = entry.dynamicPortsRule;
  return out;
}

const specs = Object.create(null) as Record<string, PatchSpec>;
const behaviors = Object.create(null) as Record<string, PatchBehavior>;
const types: string[] = [];

for (const chunk of CATALOG_CHUNKS) {
  for (const entry of chunk.patches) {
    if (Object.hasOwn(specs, entry.type)) {
      throw new Error(`Patch type "${entry.type}" appears twice in the catalog (second copy in ${chunk.file}).`);
    }
    specs[entry.type] = deepFreeze(toSpec(entry));
    behaviors[entry.type] = deepFreeze(toBehavior(entry));
    types.push(entry.type);
  }
}

/** Every catalog patch spec by type key (null-prototype object). */
export const SPECS: Readonly<Record<string, PatchSpec>> = Object.freeze(specs);

/** Catalog-only text by type key: behavior, import aliases, Origami port labels, default notes. */
export const BEHAVIORS: Readonly<Record<string, PatchBehavior>> = Object.freeze(behaviors);

/** Every catalog type key in catalog order (index.json order). */
export const PATCH_TYPES: readonly string[] = Object.freeze(types);

/** The catalog spec for `type`, or undefined. */
export function getSpec(type: string): PatchSpec | undefined {
  return Object.hasOwn(SPECS, type) ? SPECS[type] : undefined;
}

/** True when `type` is a catalog patch type. */
export function hasSpec(type: string): boolean {
  return Object.hasOwn(SPECS, type);
}
