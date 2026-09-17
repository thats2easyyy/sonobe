/** Patch reference: registry specs as searchable reference entries with port tables. */

import type { PatchCategory, PatchSpec, PortSpec, Registry, Value, ValueType } from "@sonobe/core";
import { CATEGORY_LABELS, CATEGORY_ORDER, STATUS_LABELS, TIER_LABELS } from "@sonobe/patches";
import { fuzzySearch, type FuzzyKey, type FuzzyResult } from "../../ui/lib/fuzzy.ts";

export interface PatchReferenceItem {
  type: string;
  name: string;
  category: PatchCategory;
  categoryLabel: string;
  summary: string;
  aliases: readonly string[];
  portNames: string[];
  spec: PatchSpec;
}

/** Every patch type in the registry, in category order, then by name. */
export function listPatchReference(registry: Pick<Registry, "patches">): PatchReferenceItem[] {
  const order = new Map(CATEGORY_ORDER.map((c, i) => [c, i]));
  return [...registry.patches.values()]
    .map((spec) => ({
      type: spec.type,
      name: spec.name,
      category: spec.category,
      categoryLabel: CATEGORY_LABELS[spec.category] ?? spec.category,
      summary: spec.summary,
      aliases: spec.aliases ?? [],
      portNames: [...spec.inputs, ...spec.outputs].map((p) => p.name),
      spec,
    }))
    .sort((a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99) || a.name.localeCompare(b.name));
}

const NAME_KEYS: readonly FuzzyKey<PatchReferenceItem>[] = [
  { name: "name", get: (i) => i.name },
  { name: "aliases", get: (i) => i.aliases, weight: 0.9 },
  { name: "type", get: (i) => i.type, weight: 0.8 },
];

/**
 * Fuzzy match on names, aliases, and type keys, then plain-text matches in summaries and port
 * names. An empty query lists everything (optionally one category).
 */
export function searchPatchReference(items: readonly PatchReferenceItem[], query: string, category: PatchCategory | null = null): FuzzyResult<PatchReferenceItem>[] {
  const scoped = category ? items.filter((i) => i.category === category) : items;
  const q = query.trim();
  if (!q) return scoped.map((item, index) => ({ item, score: 0, index, matches: {} }));
  const ranked = fuzzySearch(scoped, q, NAME_KEYS);
  // Scattered in-order letter matches ("spring" in "Split Text") rank far below real hits; drop them.
  const top = ranked[0]?.score ?? 0;
  const named = ranked.filter((r) => r.score >= top * 0.25);
  const found = new Set(named.map((r) => r.item.type));
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const described: FuzzyResult<PatchReferenceItem>[] = [];
  scoped.forEach((item, index) => {
    if (found.has(item.type)) return;
    const haystack = `${item.summary} ${item.portNames.join(" ")}`.toLowerCase();
    if (terms.every((t) => haystack.includes(t))) described.push({ item, score: 0, index, matches: {} });
  });
  return [...named, ...described];
}

/** A port default as short display text ("5", "on", "#FF375FFF", "[0, 0]"), or "" when there's none. */
export function formatPortDefault(value: Value | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
  if (typeof value === "string") return value === "" ? "“”" : value;
  if (Array.isArray(value)) return `[${value.map((v) => formatPortDefault(v as Value)).join(", ")}]`;
  try {
    const text = JSON.stringify(value);
    return text.length > 40 ? `${text.slice(0, 39)}…` : text;
  } catch {
    return "";
  }
}

export interface PortRow {
  key: string;
  name: string;
  type: ValueType | "variant";
  description: string;
  defaultText: string;
  /** Repeating port ("Value 1…N"). */
  variadic?: { min: number; max: number };
  advanced?: boolean;
}

/** Input or output rows for a spec, including a variadic row on its side. */
export function patchPortRows(spec: PatchSpec, side: "inputs" | "outputs"): PortRow[] {
  const rows: PortRow[] = spec[side].map((port: PortSpec) => ({
    key: port.key,
    name: port.name,
    type: port.type,
    description: port.description,
    defaultText: side === "inputs" ? formatPortDefault(port.default) : "",
    ...(port.advanced ? { advanced: true } : {}),
  }));
  const variadic = spec.variadic;
  if (variadic && (variadic.direction ?? "inputs") === side) {
    const first = variadic.startIndex ?? 1;
    rows.push({
      key: `${variadic.key}${first}`,
      name: `${variadic.name} ${first}…`,
      type: variadic.type,
      description: variadic.description,
      defaultText: side === "inputs" ? formatPortDefault(variadic.default) : "",
      variadic: { min: variadic.min, max: variadic.max },
    });
  }
  return rows;
}

/** "Everyday essentials", "Web-limited: …", etc. */
export function patchAvailability(spec: PatchSpec): { tier: string | null; status: string | null; reason: string | null } {
  return {
    tier: spec.tier ? (TIER_LABELS[spec.tier] ?? null) : null,
    status: spec.status && spec.status !== "supported" ? (STATUS_LABELS[spec.status] ?? spec.status) : null,
    reason: spec.status && spec.status !== "supported" ? (spec.statusReason ?? null) : null,
  };
}
