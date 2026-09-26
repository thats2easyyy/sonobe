/**
 * Patch picker catalog: every registry patch (plus patch components in the document), grouped for
 * browsing (the everyday flow patches, then project components, then categories) and ranked by tier
 * when searching, so everyday patches win close matches.
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
  /** A copy shown in the "Common" group while browsing. */
  common?: true;
}

export const COMMON_GROUP = "Common";
export const COMPONENTS_GROUP = "Components in this project";

/** The patches most flows start from, in flow order: Interaction, then what it drives. */
export const COMMON_PATCH_TYPES = ["interaction", "switch", "popAnimation", "transition", "delay", "optionPicker"] as const;

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

/** Picker items in browsing order: project components, then category, tier and name. */
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
  const cat = (item: PickerItem) => (item.componentId ? -1 : PATCH_CATEGORIES.indexOf(item.spec.category));
  return items.sort((a, b) => cat(a) - cat(b) || tierOf(a) - tierOf(b) || a.name.localeCompare(b.name));
}

/** Items for an empty query: a leading "Common" group of copies, then everything in browsing order. */
export function pickerBrowseItems(items: readonly PickerItem[]): PickerItem[] {
  const common = COMMON_PATCH_TYPES.flatMap((type) => {
    const item = items.find((i) => i.spec.type === type && !i.componentId);
    return item ? [{ ...item, id: `common:${item.id}`, common: true as const }] : [];
  });
  return [...common, ...items];
}

/** Section header for a picker item (empty query). */
export function pickerGroup(item: PickerItem): string {
  return item.common ? COMMON_GROUP : item.componentId ? COMPONENTS_GROUP : CATEGORY_LABELS[item.spec.category];
}

/** Rank picker items for a query (the order SearchList shows). */
export function searchPicker(items: readonly PickerItem[], query: string, limit?: number): PickerItem[] {
  return fuzzySearch(items, query, PICKER_KEYS, limit === undefined ? {} : { limit }).map((r) => r.item);
}

const EXCERPT_CHARS = 140;
const wordsOf = (text: string) => text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];

/** Whole sentences from a patch's docs as plain text (headings, lists and code skipped), leaving out ones that just repeat the summary. */
export function docsExcerpt(docs: string | undefined, summary = ""): string | undefined {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let fenced = false;
  const flush = () => {
    if (current.length) paragraphs.push(current.join(" "));
    current = [];
  };
  for (const line of (docs ?? "").split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    if (fenced || line.startsWith("```") || !line.trim() || /^(#|\s*[-*] )/.test(line)) flush();
    else current.push(line.trim());
  }
  flush();
  const known = new Set(wordsOf(summary));
  const sentences = paragraphs
    .slice(0, 3)
    .join(" ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .match(/[^.!?]+[.!?]+(?=\s|$)/g)
    ?.map((sentence) => sentence.trim())
    .filter((sentence) => {
      const words = wordsOf(sentence);
      return words.length === 0 || words.filter((w) => known.has(w)).length / words.length < 0.6;
    });
  const excerpt: string[] = [];
  for (const sentence of sentences ?? []) {
    if (excerpt.join(" ").length + sentence.length > EXCERPT_CHARS && excerpt.length) break;
    excerpt.push(sentence);
  }
  const text = excerpt.join(" ");
  return text && text.length <= EXCERPT_CHARS * 1.5 ? text : undefined;
}
