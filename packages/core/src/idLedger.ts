/**
 * The ids a host session has seen (ARCHITECTURE §3.2). An id that belonged to an item of a component
 * at any committed revision this session, and isn't live there when a batch starts, is retired in
 * that component: new items never get it, so anything still holding the old id (an agent's notes, a
 * simulator path, a selection) fails instead of reaching a different item. Both hosts, the editor
 * store and the headless session, keep one ledger per open document and pass it to applyOps as
 * `seenIds`, observing every commit, undo and redo.
 */

import { componentItemIds } from "./registry.ts";
import type { Component, Id, SonobeDocument } from "./types.ts";

export interface SeenIds {
  /** Component id → every item id (layer, patch, comment) seen in it this session. */
  readonly items: ReadonlyMap<Id, ReadonlySet<Id>>;
  /** Every component id seen this session. */
  readonly components: ReadonlySet<Id>;
  /** Knob ids seen this session (none until documents have knobs). */
  readonly knobs: ReadonlySet<Id>;
  /** Preset ids seen this session (none until documents have presets). */
  readonly presets: ReadonlySet<Id>;
}

/** SeenIds as plain JSON (sorted), for drafts that continue a session. */
export interface SeenIdsJSON {
  items: Record<Id, Id[]>;
  components: Id[];
  knobs: Id[];
  presets: Id[];
}

export interface IdLedger extends SeenIds {
  /** Record the ids in `doc`: every component, or only `components` (e.g. ApplyResult.affected.components). */
  observe(doc: SonobeDocument, components?: Iterable<Id>): void;
  /** Add ids another ledger saw (a restored draft continues its session). */
  merge(seen: SeenIds): void;
  /** True when `id` was seen in `component` this session but isn't live there in `doc`. */
  isRetired(doc: SonobeDocument, component: Id, id: Id): boolean;
  /** Forget everything (a document was opened). */
  clear(): void;
}

/** Live item ids per component object; documents are immutable, so a component's set never changes. */
const liveIds = new WeakMap<Component, ReadonlySet<Id>>();

export function liveItemIds(component: Component): ReadonlySet<Id> {
  let ids = liveIds.get(component);
  if (!ids) liveIds.set(component, (ids = componentItemIds(component)));
  return ids;
}

export function createIdLedger(initial?: SonobeDocument): IdLedger {
  const items = new Map<Id, Set<Id>>();
  const components = new Set<Id>();
  const knobs = new Set<Id>();
  const presets = new Set<Id>();
  const itemSet = (component: Id) => {
    let set = items.get(component);
    if (!set) items.set(component, (set = new Set()));
    return set;
  };
  const ledger: IdLedger = {
    items,
    components,
    knobs,
    presets,
    observe(doc, only) {
      for (const id of only ?? Object.keys(doc.components)) {
        const c = Object.hasOwn(doc.components, id) ? doc.components[id] : undefined;
        if (!c) continue;
        components.add(id);
        const set = itemSet(id);
        for (const item of liveItemIds(c)) set.add(item);
      }
    },
    merge(seen) {
      for (const [component, ids] of seen.items) {
        const set = itemSet(component);
        for (const id of ids) set.add(id);
      }
      for (const id of seen.components) components.add(id);
      for (const id of seen.knobs) knobs.add(id);
      for (const id of seen.presets) presets.add(id);
    },
    isRetired(doc, component, id) {
      if (!items.get(component)?.has(id)) return false;
      const c = Object.hasOwn(doc.components, component) ? doc.components[component] : undefined;
      return !c || !liveItemIds(c).has(id);
    },
    clear() {
      items.clear();
      components.clear();
      knobs.clear();
      presets.clear();
    },
  };
  if (initial) ledger.observe(initial);
  return ledger;
}

/** The retired item ids of each component that has any: seen this session and not live in `doc`. */
export function retiredIds(seen: SeenIds, doc: SonobeDocument): Record<Id, Id[]> {
  const out: Record<Id, Id[]> = {};
  for (const [component, ids] of seen.items) {
    const c = Object.hasOwn(doc.components, component) ? doc.components[component] : undefined;
    const live = c ? liveItemIds(c) : undefined;
    const retired = [...ids].filter((id) => !live?.has(id)).sort();
    if (retired.length) out[component] = retired;
  }
  return out;
}

/**
 * `seen` without the ids live in `doc`. An apply given it may create items under ids `doc` has: a
 * host that undoes a gesture's provisional steps and applies their final version as one step (an
 * amend) passes the document from before the undo, so the final ops can create the same items again.
 */
export function seenIdsExcept(seen: SeenIds, doc: SonobeDocument): SeenIds {
  const items = new Map<Id, ReadonlySet<Id>>();
  for (const [component, ids] of seen.items) {
    const c = Object.hasOwn(doc.components, component) ? doc.components[component] : undefined;
    const live = c ? liveItemIds(c) : undefined;
    items.set(component, live ? new Set([...ids].filter((id) => !live.has(id))) : ids);
  }
  const components = new Set([...seen.components].filter((id) => !Object.hasOwn(doc.components, id)));
  return { items, components, knobs: seen.knobs, presets: seen.presets };
}

export function seenIdsToJSON(seen: SeenIds): SeenIdsJSON {
  const items: Record<Id, Id[]> = {};
  for (const component of [...seen.items.keys()].sort()) items[component] = [...seen.items.get(component)!].sort();
  return { items, components: [...seen.components].sort(), knobs: [...seen.knobs].sort(), presets: [...seen.presets].sort() };
}

/** SeenIds from JSON written by seenIdsToJSON. Anything malformed is skipped, so a damaged draft reads as fewer seen ids. */
export function seenIdsFromJSON(json: unknown): SeenIds {
  const record = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const ids = (value: unknown) => new Set<Id>(Array.isArray(value) ? value.filter((v): v is Id => typeof v === "string") : []);
  const items = new Map<Id, ReadonlySet<Id>>();
  const rawItems = record.items;
  if (rawItems && typeof rawItems === "object" && !Array.isArray(rawItems)) {
    for (const [component, list] of Object.entries(rawItems)) items.set(component, ids(list));
  }
  return { items, components: ids(record.components), knobs: ids(record.knobs), presets: ids(record.presets) };
}
