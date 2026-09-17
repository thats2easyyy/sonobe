/**
 * Schema discovery text: patch type search and descriptions, layer types, and value types.
 * The content comes from the same declarations the editor and docs use. Browser-safe.
 */

import {
  CONVERTER_CANDIDATES,
  VALUE_TYPES,
  canConnect,
  createEmptyDocument,
  resolveNodePorts,
  typeLabel,
  type LayerTypeSpec,
  type PatchCategory,
  type PatchSpec,
  type PortSpec,
  type ValueType,
} from "@sonobe/core";
import { NATIVE_PATCH_TYPES, type EngineRegistry } from "@sonobe/engine";
import { BEHAVIORS, CATEGORY_LABELS, CATEGORY_ORDER } from "@sonobe/patches";
import { formatValue, plural } from "./format.ts";

export type Detail = "names" | "summary" | "standard" | "full";

/** True when the registry has a real evaluator for `type` (native engine types count). */
export function isImplemented(registry: EngineRegistry, type: string): boolean {
  if (NATIVE_PATCH_TYPES.has(type)) return true;
  const withStatus = registry as EngineRegistry & { isImplemented?: (type: string) => boolean };
  if (typeof withStatus.isImplemented === "function") return withStatus.isImplemented(type);
  return registry.definitions.has(type);
}

const EMPTY_DOC = createEmptyDocument({ name: "catalog" });

function portType(p: PortSpec, typeParam?: string): string {
  return p.type === "variant" ? (typeParam ?? "variant") : p.type;
}

/** "number:number=0" style token. */
function portToken(p: PortSpec, typeParam?: string): string {
  return `${p.key}:${portType(p, typeParam)}`;
}

function staticPorts(spec: PatchSpec): { inputs: PortSpec[]; outputs: PortSpec[] } {
  const ports = resolveNodePorts(
    EMPTY_DOC,
    { type: spec.type, inputs: {}, ui: { x: 0, y: 0 } },
    { patches: new Map([[spec.type, spec]]), layers: new Map() },
  );
  return ports
    ? { inputs: ports.inputs, outputs: ports.outputs }
    : { inputs: spec.inputs, outputs: spec.outputs };
}

export interface PatchSearchOptions {
  query?: string;
  category?: PatchCategory;
  implementedOnly?: boolean;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Rank patch types by how well they match a query (names, aliases, summary, port keys). */
export function searchPatchTypes(
  registry: EngineRegistry,
  options: PatchSearchOptions = {},
): PatchSpec[] {
  const all = [...registry.patches.values()].filter(
    (s) =>
      (!options.category || s.category === options.category) &&
      (!options.implementedOnly || isImplemented(registry, s.type)),
  );
  const order = (s: PatchSpec) => CATEGORY_ORDER.indexOf(s.category) * 1000 + (s.tier ?? 2);
  const query = options.query?.trim().toLowerCase();
  if (!query) return all.sort((a, b) => order(a) - order(b) || a.type.localeCompare(b.type));
  const qWords = words(query);
  const scored = all
    .map((spec) => {
      const type = spec.type.toLowerCase();
      const name = spec.name.toLowerCase();
      const aliases = (spec.aliases ?? []).map((a) => a.toLowerCase());
      let score = 0;
      if (type === query || name === query || aliases.includes(query)) score += 100;
      if (type.startsWith(query) || name.startsWith(query)) score += 40;
      if (
        type.includes(query.replace(/\s+/g, "")) ||
        name.includes(query) ||
        aliases.some((a) => a.includes(query))
      )
        score += 25;
      const hay = new Set([
        ...words(spec.name),
        ...words(spec.summary),
        ...aliases.flatMap(words),
        ...words(spec.type.replace(/([A-Z])/g, " $1")),
        ...[...spec.inputs, ...spec.outputs].map((p) => p.key.toLowerCase()),
      ]);
      for (const w of qWords) {
        if (hay.has(w)) score += 8;
        else if ([...hay].some((h) => h.startsWith(w) && w.length >= 3)) score += 4;
      }
      if (score > 0 && spec.tier === 1) score += 3;
      return { spec, score };
    })
    .filter((s) => s.score > 0);
  return scored
    .sort((a, b) => b.score - a.score || order(a.spec) - order(b.spec))
    .map((s) => s.spec);
}

/** One line per type: "popAnimation · Pop Animation — summary (in: … → out: …)". */
export function patchListLine(
  registry: EngineRegistry,
  spec: PatchSpec,
  detail: "names" | "summary",
): string {
  const flag = isImplemented(registry, spec.type) ? "" : " [not implemented yet]";
  if (detail === "names") return `${spec.type} (${spec.name})${flag}`;
  const ports = staticPorts(spec);
  const variants = spec.variants?.length ? `<${spec.variants.join("|")}>` : "";
  const ins = ports.inputs.map((p) => portToken(p)).join(", ");
  const outs = ports.outputs.map((p) => portToken(p)).join(", ");
  return `${spec.type}${variants} · ${spec.name}${flag} — ${spec.summary} (in: ${ins || "none"} → out: ${outs || "none"})`;
}

function range(p: PortSpec): string {
  const parts: string[] = [];
  if (p.min !== undefined) parts.push(`min ${p.min}`);
  if (p.max !== undefined) parts.push(`max ${p.max}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function portLine(p: PortSpec, typeParam?: string): string {
  const def = p.default !== undefined ? ` = ${formatValue(p.default)}` : "";
  const subtype = p.subtype ? `/${p.subtype}` : "";
  const options = p.enumOptions?.length
    ? ` options: ${p.enumOptions.map((o) => o.key).join("|")}`
    : "";
  const flags = [p.wholeLoop ? "whole loop" : "", p.advanced ? "advanced" : ""]
    .filter(Boolean)
    .join(", ");
  return `  ${p.key}: ${portType(p, typeParam)}${subtype}${def}${range(p)}${options}${flags ? ` [${flags}]` : ""} — ${p.description}`;
}

export interface DescribeOptions {
  detail?: "standard" | "full";
  includeExamples?: boolean;
}

/** A full description of a patch type for agents: ports with defaults, behavior, pairings, examples. */
export function describePatchType(
  registry: EngineRegistry,
  spec: PatchSpec,
  options: DescribeOptions = {},
): string {
  const detail = options.detail ?? "standard";
  const lines: string[] = [];
  const implemented = isImplemented(registry, spec.type);
  lines.push(
    `## ${spec.type} · ${spec.name} (${CATEGORY_LABELS[spec.category] ?? spec.category}${spec.tier ? `, tier ${spec.tier}` : ""})${implemented ? "" : " [not implemented yet: outputs default values]"}`,
  );
  lines.push(spec.summary);
  if (spec.aliases?.length) lines.push(`Aliases: ${spec.aliases.join(", ")}`);
  if (spec.variants?.length)
    lines.push(
      `typeParam: ${spec.variants.join(" | ")} (default ${spec.variants[0]}); "variant" ports take this type.`,
    );
  if (spec.variadic) {
    const v = spec.variadic;
    // Core expands variadic ports from startIndex, so these are exactly the keys validation accepts.
    const start = v.startIndex ?? 1;
    const keys = Array.from(
      { length: Math.min(3, Math.max(1, v.defaultCount)) },
      (_, i) => `"${v.key}${start + i}"`,
    ).join(", ");
    lines.push(
      `inputCount: ${v.min}–${v.max} (default ${v.defaultCount}); repeats ${v.direction ?? "inputs"} ${keys}, … one per inputCount, numbered from ${start} (${v.key}${start}–${v.key}${start + v.defaultCount - 1} at the default count) — ${v.description}`,
    );
  }
  if (spec.status && spec.status !== "supported")
    lines.push(`Status: ${spec.status}${spec.statusReason ? ` — ${spec.statusReason}` : ""}`);
  lines.push("Inputs:");
  lines.push(
    ...(spec.inputs.length
      ? spec.inputs.filter((p) => detail === "full" || !p.advanced).map((p) => portLine(p))
      : ["  (none)"]),
  );
  const hidden = detail === "full" ? 0 : spec.inputs.filter((p) => p.advanced).length;
  if (hidden) lines.push(`  (+${plural(hidden, "advanced input")}; detail "full" shows them)`);
  lines.push("Outputs:");
  lines.push(...(spec.outputs.length ? spec.outputs.map((p) => portLine(p)) : ["  (none)"]));
  if (spec.settings?.length) {
    lines.push("Settings (PatchNode.settings, not ports):");
    for (const s of spec.settings)
      lines.push(
        `  ${s.key}: ${s.type} = ${formatValue(s.default)}${s.enumOptions?.length ? ` options: ${s.enumOptions.map((o) => o.key).join("|")}` : ""} — ${s.description}`,
      );
  }
  const behavior = BEHAVIORS[spec.type];
  if (behavior?.dynamicPortsRule) lines.push(`Dynamic ports: ${behavior.dynamicPortsRule}`);
  if (spec.variantDefaults && detail === "full")
    lines.push(`Variant defaults: ${JSON.stringify(spec.variantDefaults)}`);
  if (spec.pairsWellWith?.length) lines.push(`Pairs well with: ${spec.pairsWellWith.join(", ")}`);
  if (spec.commonMistakes?.length) {
    lines.push("Common mistakes:");
    for (const m of detail === "full" ? spec.commonMistakes : spec.commonMistakes.slice(0, 2))
      lines.push(`  - ${m}`);
  }
  if (options.includeExamples !== false && spec.examples?.length) {
    for (const ex of detail === "full" ? spec.examples : spec.examples.slice(0, 1)) {
      lines.push(`Example: ${ex.title} (outline notation; ids and ×/[n] counts are illustrative)`);
      lines.push(...ex.outline.split("\n").map((l) => `  ${l}`));
    }
  }
  if (detail === "full") {
    if (spec.docs) lines.push("Docs:", spec.docs.trim());
    if (behavior?.behavior) lines.push("Behavior:", behavior.behavior.trim());
  }
  return lines.join("\n");
}

/** A structured patch type description (for structuredContent). */
export function patchTypeData(registry: EngineRegistry, spec: PatchSpec): Record<string, unknown> {
  const port = (p: PortSpec) => ({
    key: p.key,
    name: p.name,
    type: p.type,
    ...(p.subtype ? { subtype: p.subtype } : {}),
    ...(p.default !== undefined ? { default: p.default } : {}),
    ...(p.min !== undefined ? { min: p.min } : {}),
    ...(p.max !== undefined ? { max: p.max } : {}),
    ...(p.enumOptions ? { enumOptions: p.enumOptions.map((o) => o.key) } : {}),
    ...(p.wholeLoop ? { wholeLoop: true } : {}),
    description: p.description,
  });
  return {
    type: spec.type,
    name: spec.name,
    category: spec.category,
    summary: spec.summary,
    implemented: isImplemented(registry, spec.type),
    ...(spec.tier ? { tier: spec.tier } : {}),
    ...(spec.variants ? { variants: spec.variants } : {}),
    ...(spec.variadic
      ? {
          variadic: {
            key: spec.variadic.key,
            min: spec.variadic.min,
            max: spec.variadic.max,
            defaultCount: spec.variadic.defaultCount,
            startIndex: spec.variadic.startIndex ?? 1,
            direction: spec.variadic.direction ?? "inputs",
            type: spec.variadic.type,
          },
        }
      : {}),
    inputs: spec.inputs.map(port),
    outputs: spec.outputs.map(port),
    ...(spec.settings
      ? { settings: spec.settings.map((s) => ({ key: s.key, type: s.type, default: s.default })) }
      : {}),
    ...(spec.pairsWellWith ? { pairsWellWith: spec.pairsWellWith } : {}),
  };
}

/** Describe a layer type: props grouped by category, outputs, and whether it holds children. */
export function describeLayerType(
  spec: LayerTypeSpec,
  detail: "summary" | "standard" | "full" = "standard",
): string {
  if (detail === "summary")
    return `${spec.type} · ${spec.name}${spec.canHaveChildren ? " (container)" : ""} — ${spec.summary}`;
  const lines = [
    `## ${spec.type} · ${spec.name} (${spec.category}${spec.canHaveChildren ? ", can hold child layers" : ", no children"})`,
    spec.summary,
  ];
  const props = spec.props.filter((p) => detail === "full" || !p.advanced);
  const byCategory = new Map<string, typeof props>();
  for (const p of props) byCategory.set(p.category, [...(byCategory.get(p.category) ?? []), p]);
  lines.push("Props (address as @layerId.key):");
  for (const [category, list] of byCategory) {
    lines.push(`  ${category}:`);
    for (const p of list)
      lines.push(`  ${portLine(p)}${p.bindable === false ? " [set only]" : ""}`);
  }
  const hidden = spec.props.length - props.length;
  if (hidden) lines.push(`  (+${plural(hidden, "advanced prop")}; detail "full" shows them)`);
  if (spec.outputs?.length) {
    lines.push("Read-only outputs (link from @layerId.key):");
    for (const p of spec.outputs) lines.push(portLine(p));
  }
  return lines.join("\n");
}

const LITERALS: Partial<Record<ValueType, string>> = {
  number: "1.5",
  boolean: "true",
  pulse: "(no literal; connect a pulse output)",
  text: '"Hello"',
  color: '"#FF3B30FF"',
  point: "[16, 120]",
  point3d: "[0, 0, 0]",
  point4d: "[0, 0, 0, 0]",
  size: "[358, 220]",
  anchor: "[0.5, 0.5]",
  index: "2",
  enum: '"cubicOut" (option key)',
  json: '{ "json": { "a": 1 } }',
  layer: '{ "layer": "card" }',
  image: '{ "asset": "photo_1" } or "https://…"',
  video: '{ "asset": "clip_1" }',
  sound: '{ "asset": "chime" }',
  gradient:
    '{ "gradient": { "kind": "linear", "stops": [[0, "#FFFFFFFF"], [1, "#000000FF"]], "start": [0.5, 0], "end": [0.5, 1] } }',
  shape: '"M0 0 L100 0"',
  textStyle: '{ "json": { "fontSize": 17 } }',
  layerEffect: '{ "json": { "kind": "blur", "params": { "radius": 8 } } }',
  transform: "16 numbers (column-major 4×4)",
  any: "any literal",
};

/** Value types with literal encodings, implicit conversions, and converter patches. */
export function valueTypesText(): string {
  const lines = ["Value types (literal encoding in ops):"];
  for (const type of VALUE_TYPES)
    lines.push(`  ${type} — ${typeLabel(type)}; literal ${LITERALS[type] ?? "—"}`);
  lines.push("", "Implicit conversions when connecting (shown as a glyph on the wire):");
  const pairs: [ValueType, ValueType][] = [
    ["number", "boolean"],
    ["boolean", "number"],
    ["boolean", "pulse"],
    ["pulse", "boolean"],
    ["number", "point"],
    ["point", "number"],
    ["number", "text"],
    ["text", "number"],
    ["color", "point4d"],
    ["json", "number"],
  ];
  for (const [from, to] of pairs) {
    const c = canConnect(from, to);
    lines.push(`  ${from} → ${to}: ${c.ok ? (c.conversion ?? "direct") : c.reason}`);
  }
  lines.push("", "Anything else is an invalid link. Converters that fix common mismatches:");
  for (const c of CONVERTER_CANDIDATES)
    lines.push(
      `  ${c.from === "*" ? "any" : c.from.join("|")} → ${c.to === "*" ? "any" : c.to.join("|")}: ${c.patchTypes.join(" or ")} — ${c.description}`,
    );
  lines.push(
    "",
    'Loops: any port may carry a loop; patches evaluate once per index, shorter loops wrap, layers bound to loops replicate. Write literal loops as { "loop": [1, 2, 3] }.',
  );
  lines.push(
    "Pulses: true for exactly one frame. A pulse input also fires when a boolean wired into it turns on.",
  );
  return lines.join("\n");
}

/** Group patch list lines by category label. */
export function groupByCategory(
  registry: EngineRegistry,
  specs: readonly PatchSpec[],
  detail: "names" | "summary",
): string {
  const groups = new Map<string, string[]>();
  for (const spec of specs) {
    const label = CATEGORY_LABELS[spec.category] ?? spec.category;
    groups.set(label, [...(groups.get(label) ?? []), patchListLine(registry, spec, detail)]);
  }
  return [...groups].map(([label, lines]) => `### ${label}\n${lines.join("\n")}`).join("\n\n");
}
