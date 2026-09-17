/** Toggle filters shared by the HUD tabs (console levels, diagnostic severities). */

/**
 * Toggle one key. With `solo`, show only that key (or everything again when it already was the
 * only one shown). Turning the last key off turns everything back on, so a filter never hides all.
 */
export function toggleFilter<K extends string>(filter: Readonly<Record<K, boolean>>, key: K, solo = false): Record<K, boolean> {
  const keys = Object.keys(filter) as K[];
  if (solo) {
    const alreadySolo = filter[key] && keys.every((k) => k === key || !filter[k]);
    return Object.fromEntries(keys.map((k) => [k, alreadySolo ? true : k === key])) as Record<K, boolean>;
  }
  const next = { ...filter, [key]: !filter[key] } as Record<K, boolean>;
  return keys.some((k) => next[k]) ? next : (Object.fromEntries(keys.map((k) => [k, true])) as Record<K, boolean>);
}

/** True when any key is off. */
export function isFiltered<K extends string>(filter: Readonly<Record<K, boolean>>): boolean {
  return Object.values(filter).some((on) => !on);
}
