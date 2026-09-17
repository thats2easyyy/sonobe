/**
 * Patch picker catalog: every registry patch (plus patch components in the document), grouped by
 * category for browsing and ranked by tier when searching, so everyday patches win close matches.
 */

import { COMPONENT_PATCH_SPEC, COMPONENT_PATCH_TYPE, type Id, type PatchSpec, type Registry, type SonobeDocument } from "@sonobe/core";
import { CATEGORY_LABELS, PATCH_CATEGORIES } from "../../../theme/tokens.ts";
import { fuzzySearch, type FuzzyKey } from "../../../ui/lib/fuzzy.ts";

export interface PickerItem {
  id: string;
  spec: PatchSpec;
  name: string;
  /** Component patches: the patch component to instantiate. */
  componentId?: Id;
}

const TIER_WEIGHT: Record<1 | 2 | 3, number> = { 1: 1, 2: 0.86, 3: 0.72 };
const tierOf = (item: PickerItem): 1 | 2 | 3 => item.spec.tier ?? (item.componentId ? 1 : 2);

function tiered(name: string, get: (item: PickerItem) => string | readonly string[] | undefined, weight: number): FuzzyKey<PickerItem>[] {
  return ([1, 2, 3] as const).map((tier) => ({ name, weight: weight * TIER_WEIGHT[tier], get: (item: PickerItem) => (tierOf(item) === tier ? get(item) : null) }));
}

/** Search keys: name and aliases weighted by tier, then type key, port names, and category. */
export const PICKER_KEYS: readonly FuzzyKey<PickerItem>[] = [
  ...tiered("name", (i) => i.name, 1),
  ...tiered("aliases", (i) => i.spec.aliases, 0.8),
  { name: "type", get: (i) => i.spec.type, weight: 0.6 },
  { name: "ports", get: (i) => [...i.spec.inputs, ...i.spec.outputs].map((p) => p.name), weight: 0.4 },
  { name: "category", get: (i) => CATEGORY_LABELS[i.spec.category], weight: 0.35 },
];

/** Picker items in browsing order: category, then tier, then name. */
export function pickerItems(registry: Registry, doc?: SonobeDocument): PickerItem[] {
  const items: PickerItem[] = [];
  for (const spec of registry.patches.values()) {
    if (spec.type === COMPONENT_PATCH_TYPE) continue;
    items.push({ id: spec.type, spec, name: spec.name });
  }
  for (const c of Object.values(doc?.components ?? {})) {
    if (c.kind !== "patchComponent") continue;
    items.push({ id: `component:${c.id}`, spec: { ...COMPONENT_PATCH_SPEC, name: c.name, summary: c.notes || COMPONENT_PATCH_SPEC.summary }, name: c.name, componentId: c.id });
  }
  const cat = (item: PickerItem) => PATCH_CATEGORIES.indexOf(item.spec.category);
  return items.sort((a, b) => cat(a) - cat(b) || tierOf(a) - tierOf(b) || a.name.localeCompare(b.name));
}

/** Rank picker items for a query (the order SearchList shows). */
export function searchPicker(items: readonly PickerItem[], query: string, limit?: number): PickerItem[] {
  return fuzzySearch(items, query, PICKER_KEYS, limit === undefined ? {} : { limit }).map((r) => r.item);
}
