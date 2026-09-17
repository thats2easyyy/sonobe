/**
 * Command palette ordering: recent commands, then categories in the order of the app menus (File,
 * Edit, View, Layer, Patch, Prototype, Help), then panel categories, then anything else in the
 * order it was registered. Commands keep registration order inside a category.
 */

import type { Command } from "./commandRegistry.ts";

export interface PaletteItem {
  command: Command;
  group: string;
}

/** Menu categories first, then panels. */
export const COMMAND_CATEGORY_ORDER: readonly string[] = ["File", "Edit", "View", "Layer", "Patch", "Prototype", "Help", "Layers", "Viewer", "Canvas", "Patches", "Inspector", "Console", "Learn"];

export const RECENT_GROUP = "Recent";
const FALLBACK_CATEGORY = "General";

/** Recent commands (at most `maxRecent`) followed by every other available command in curated category order. */
export function orderPaletteItems(available: readonly Command[], recentIds: readonly string[], maxRecent = 5): PaletteItem[] {
  const byId = new Map(available.map((c) => [c.id, c]));
  const recent = recentIds.filter((id) => byId.has(id)).slice(0, maxRecent);
  const rank = new Map<string, number>(COMMAND_CATEGORY_ORDER.map((c, i) => [c, i]));
  const extra = new Map<string, number>();
  for (const c of available) {
    const category = c.category ?? FALLBACK_CATEGORY;
    if (!rank.has(category) && !extra.has(category)) extra.set(category, extra.size);
  }
  const rankOf = (category: string) => rank.get(category) ?? (category === FALLBACK_CATEGORY ? COMMAND_CATEGORY_ORDER.length + extra.size : COMMAND_CATEGORY_ORDER.length + extra.get(category)!);
  const rest = available
    .filter((c) => !recent.includes(c.id))
    .map((c, index) => ({ command: c, group: c.category ?? FALLBACK_CATEGORY, index }))
    .sort((a, b) => rankOf(a.group) - rankOf(b.group) || a.index - b.index)
    .map(({ command, group }) => ({ command, group }));
  return [...recent.map((id) => ({ command: byId.get(id)!, group: RECENT_GROUP })), ...rest];
}
