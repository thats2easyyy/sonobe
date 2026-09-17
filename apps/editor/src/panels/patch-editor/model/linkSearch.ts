/**
 * Link-drag search: drop a cable on empty canvas and pick a patch to connect it to. Candidates are
 * every registry patch port on the opposite side whose type accepts the dragged port, with the best
 * variant chosen per patch (Transition on color for a color cable). Exact type matches, patches the
 * source "pairs well with", and everyday tiers rank first.
 */

import { canConnect, COMPONENT_PATCH_TYPE, getPatchSpec, resolveNodePorts, type PatchNode, type PatchSpec, type Registry, type ResolvedPort, type SonobeDocument, type ValueType } from "@sonobe/core";
import { CATEGORY_LABELS } from "../../../theme/tokens.ts";
import { fuzzySearch, type FuzzyKey } from "../../../ui/lib/fuzzy.ts";
import type { PortSide } from "./types.ts";

export interface LinkSearchSource {
  /** The side you dragged from: "out" looks for inputs, "in" looks for outputs. */
  side: PortSide;
  type: ValueType;
  /** Type of the patch you dragged from (for "pairs well with"). */
  patchType?: string;
}

export interface LinkSearchItem {
  id: string;
  spec: PatchSpec;
  typeParam?: ValueType;
  /** The port on the new patch that the cable connects to. */
  port: ResolvedPort;
  exact: boolean;
  suggested: boolean;
  conversion?: string;
  /** Rank for an empty query (lower first). */
  rank: number;
}

const tierOf = (spec: PatchSpec) => spec.tier ?? 2;

function orderedVariants(variants: readonly ValueType[], type: ValueType): ValueType[] {
  return variants.includes(type) ? [type, ...variants.filter((v) => v !== type)] : [...variants];
}

/** Every compatible (patch, port) pair for a dragged port, ranked for an empty query. */
export function linkSearchItems(doc: SonobeDocument, registry: Registry, source: LinkSearchSource): LinkSearchItem[] {
  const fromSpec = source.patchType ? getPatchSpec(registry, source.patchType) : undefined;
  const pairs = new Set(fromSpec?.pairsWellWith ?? []);
  const items: LinkSearchItem[] = [];
  let order = 0;
  for (const spec of registry.patches.values()) {
    order++;
    if (spec.type === COMPONENT_PATCH_TYPE) continue;
    const variants: (ValueType | undefined)[] = spec.variants?.length ? orderedVariants(spec.variants, source.type) : [undefined];
    const seen = new Set<string>();
    for (const variant of variants) {
      const node: PatchNode = { type: spec.type, inputs: {}, ui: { x: 0, y: 0 } };
      if (variant) node.typeParam = variant;
      const ports = resolveNodePorts(doc, node, registry);
      if (!ports) continue;
      for (const port of source.side === "out" ? ports.inputs : ports.outputs) {
        if (seen.has(port.key) || (port.variadicIndex !== undefined && port.variadicIndex > 1)) continue;
        const check =source.side === "out" ? canConnect(source.type, port.type) : canConnect(port.type, source.type);
        if (!check.ok) continue;
        seen.add(port.key);
        const exact = port.type === source.type;
        const suggested = pairs.has(spec.type);
        const rank = (exact ? 0 : port.type === "any" ? 2 : 1) * 10 + (suggested ? 0 : 3) + tierOf(spec) + (port.advanced ? 4 : 0) + order / 10_000;
        const item: LinkSearchItem = { id: `${spec.type}|${port.key}`, spec, port, exact, suggested, rank };
        if (variant) item.typeParam = variant;
        if (check.conversion) item.conversion = check.conversion;
        items.push(item);
      }
    }
  }
  return items.sort((a, b) => a.rank - b.rank);
}

const WEIGHTS: [exact: boolean, tier: 1 | 2 | 3, weight: number][] = [
  [true, 1, 1],
  [true, 2, 0.9],
  [true, 3, 0.8],
  [false, 1, 0.86],
  [false, 2, 0.78],
  [false, 3, 0.7],
];

function weighted(name: string, get: (item: LinkSearchItem) => string | readonly string[] | undefined, base: number): FuzzyKey<LinkSearchItem>[] {
  return WEIGHTS.map(([exact, tier, weight]) => ({ name, weight: base * weight, get: (item: LinkSearchItem) => (item.exact === exact && tierOf(item.spec) === tier ? get(item) : null) }));
}

/** Search keys (weighted by exactness and tier, so SearchList ranks the same way). */
export const LINK_SEARCH_KEYS: readonly FuzzyKey<LinkSearchItem>[] = [
  ...weighted("name", (i) => i.spec.name, 1),
  ...weighted("aliases", (i) => i.spec.aliases, 0.75),
  ...weighted("port", (i) => i.port.name, 0.6),
  { name: "type", get: (i) => i.spec.type, weight: 0.5 },
  { name: "category", get: (i) => CATEGORY_LABELS[i.spec.category], weight: 0.35 },
];

/** Filter and rank link-search items for a query. */
export function searchLinkItems(items: readonly LinkSearchItem[], query: string, limit?: number): LinkSearchItem[] {
  if (!query.trim()) return limit === undefined ? [...items] : items.slice(0, limit);
  return fuzzySearch(items, query, LINK_SEARCH_KEYS, limit === undefined ? {} : { limit }).map((r) => r.item);
}
