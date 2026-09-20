/**
 * The replace guard: before import_design replaces a layer, ask the person when it's one they didn't
 * pick and the Assistant didn't make in this chat, or one they changed since the Assistant made it.
 * Per chat and in memory: it fingerprints the screens the Assistant imported, layer by layer, as each
 * of its writes left them, so undoing back to one of its versions isn't the person's change, and
 * keeps the person's own screen a replace took the place of, so undoing back to that isn't either.
 * Pure functions over documents; the agent loop asks and runs the dry run.
 */

import { findLayer, layerDisplayName, type Id, type LayerNode, type SonobeDocument } from "@sonobe/core";
import type { ConfirmPrompt } from "./guardrails.ts";

export interface ReplaceImpact { dropped: string[]; droppedCount: number; lostConnections: number }
export interface ReplaceCheck {
  reason: "untargeted" | "hand_edited";
  target: { id: Id; name: string };
  /** Display names of layers the person changed since the Assistant made them (first 5), for hand_edited. */
  changed: string[];
  changedCount: number;
}
/** What a write changed, as its result's `affected` says (layer ids are unique only within a component). */
export interface WriteAffected { components: readonly Id[]; layers: readonly Id[] }
export interface ReplaceGuard {
  /** Null: go ahead without asking. */
  check(request: { docId: string; component: Id; replace: Id; picked: Id | null }, doc: SonobeDocument): ReplaceCheck | null;
  /**
   * A successful import_design: the screen is the Assistant's own now (records inside it go; a replace
   * keeps the screen's earlier versions). `before`: the document the replace was checked against, so
   * a person's own screen it replaced is theirs again when their Undo takes it back.
   */
  remember(docId: string, component: Id, screenId: Id, doc: SonobeDocument, before?: SonobeDocument): void;
  /** Another successful Assistant write: take the layers it changed into the records of the components it changed. */
  refresh(docId: string, doc: SonobeDocument, affected: WriteAffected): void;
  tracks(docId: string): boolean;
  clear(): void;
}

/** Names a message lists before "and N more". */
const LISTED = 5;
/** Screens one chat remembers; the oldest go first. */
const MAX_RECORDS = 50;
/** Versions of one screen it keeps, for undoing back through the Assistant's writes; the oldest go first. */
const MAX_STATES = 20;

/** What the guard keeps of one layer: its content, and where it sits. */
interface LayerPrint {
  name: string;
  /** FNV-1a of { type, name, props without position, locked, component }. */
  content: string;
  /** Its position prop as canonical JSON ("" when it has none). */
  position: string;
  parent: Id | null;
  index: number;
}

/** A screen the Assistant made: its layers as each of the Assistant's writes left them. */
interface ScreenRecord {
  docId: string;
  component: Id;
  root: Id;
  /** Oldest first, at most MAX_STATES; the last is the latest. Never changed in place. */
  states: Map<Id, LayerPrint>[];
  /** The person's own screen the Assistant's first replace of it took the place of. Not one of `states`: it's still theirs. */
  original?: Map<Id, LayerPrint>;
}

const latest = (record: ScreenRecord): Map<Id, LayerPrint> => record.states.at(-1)!;
const pushState = (record: ScreenRecord, state: Map<Id, LayerPrint>) => {
  record.states = [...record.states, state].slice(-MAX_STATES);
};
const samePrint = (a: LayerPrint | undefined, b: LayerPrint | undefined) =>
  a === b || (!!a && !!b && a.content === b.content && a.position === b.position && a.parent === b.parent && a.index === b.index);

/** JSON with object keys sorted, so equal values print the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** 32-bit FNV-1a over UTF-16 code units, as 8 hex digits. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function printLayer(layer: LayerNode, parent: Id | null, index: number): LayerPrint {
  const { position, ...props } = layer.props;
  const content = canonical({ type: layer.type, name: layer.name, props, locked: layer.locked === true, component: layer.component });
  return { name: layerDisplayName(layer), content: fnv1a(content), position: position === undefined ? "" : canonical(position), parent, index };
}

/** Every layer of `rootId`'s subtree in walk order (back → front), the root first; null when it isn't in the component. */
function printSubtree(doc: SonobeDocument, component: Id, rootId: Id): Map<Id, LayerPrint> | null {
  const layers = doc.components[component]?.layers;
  const loc = layers ? findLayer(layers, rootId) : undefined;
  if (!loc) return null;
  const out = new Map<Id, LayerPrint>();
  const visit = (layer: LayerNode, parent: Id | null, index: number) => {
    out.set(layer.id, printLayer(layer, parent, index));
    layer.children?.forEach((child, i) => visit(child, layer.id, i));
  };
  visit(loc.layer, loc.parent?.id ?? null, loc.index);
  return out;
}

/** FNV-1a per layer of { type, name, props, parent, index, locked } (the root's position, parent and index left out: a replace keeps them). Deterministic key order. */
export function fingerprintSubtree(doc: SonobeDocument, component: Id, rootId: Id): Map<Id, { hash: string; name: string }> {
  const out = new Map<Id, { hash: string; name: string }>();
  for (const [id, print] of printSubtree(doc, component, rootId) ?? []) {
    const place = id === rootId ? "" : `|${print.position}|${canonical(print.parent)}|${print.index}`;
    out.set(id, { hash: fnv1a(`${print.content}${place}`), name: print.name });
  }
  return out;
}

/** The recorded layers inside `rootId` (itself included), by the parents they had then. */
function recordedSubtree(layers: Map<Id, LayerPrint>, rootId: Id): Map<Id, LayerPrint> {
  const inside = new Map<Id, boolean>([[rootId, true]]);
  const isInside = (id: Id | null): boolean => {
    if (id === null) return false;
    const known = inside.get(id);
    if (known !== undefined) return known;
    inside.set(id, false); // a cycle ends here
    const print = layers.get(id);
    const result = print ? isInside(print.parent) : false;
    inside.set(id, result);
    return result;
  };
  const out = new Map<Id, LayerPrint>();
  for (const [id, print] of layers) if (isInside(id)) out.set(id, print);
  return out;
}

/** Layers in `after` that left their order in `before` (both hold the same ids): those off the longest run that kept it. */
function movedIds(before: readonly Id[], after: readonly Id[]): Id[] {
  const rank = new Map(before.map((id, i) => [id, i] as const));
  const seq = after.map((id) => rank.get(id)!);
  const length = seq.map(() => 1);
  const previous = seq.map(() => -1);
  let best = 0;
  for (let i = 0; i < seq.length; i++) {
    for (let j = 0; j < i; j++) {
      if (seq[j]! < seq[i]! && length[j]! + 1 > length[i]!) {
        length[i] = length[j]! + 1;
        previous[i] = j;
      }
    }
    if (length[i]! > length[best]!) best = i;
  }
  const kept = new Set<number>();
  for (let i = best; i >= 0 && seq.length; i = previous[i]!) kept.add(i);
  return after.filter((_, i) => !kept.has(i));
}

/**
 * The layers of `rootId`'s subtree that changed since one of the record's states (`root` is the
 * record's root): content, position or parent that differs, a new layer, a gone one, or one out of
 * its old order among its siblings (a sibling removed or added doesn't move the others). The root's
 * own position, parent and index don't count: a replace keeps them. Display names in walk order,
 * gone layers last.
 */
function changesSince(state: Map<Id, LayerPrint>, root: Id, current: Map<Id, LayerPrint>, rootId: Id): string[] {
  const recorded = root === rootId ? state : recordedSubtree(state, rootId);
  const changed = new Set<Id>();
  const siblings = new Map<Id, Id[]>();
  for (const [id, now] of current) {
    const then = recorded.get(id);
    if (!then || now.content !== then.content) changed.add(id);
    else if (id !== rootId && (now.position !== then.position || now.parent !== then.parent)) changed.add(id);
    else if (id !== rootId && now.parent !== null) {
      const list = siblings.get(now.parent);
      if (list) list.push(id);
      else siblings.set(now.parent, [id]);
    }
  }
  for (const ids of siblings.values()) {
    const before = [...ids].sort((a, b) => recorded.get(a)!.index - recorded.get(b)!.index);
    if (before.some((id, i) => id !== ids[i])) for (const id of movedIds(before, ids)) changed.add(id);
  }
  const names = [...current].filter(([id]) => changed.has(id)).map(([, print]) => print.name);
  for (const [id, then] of recorded) if (!current.has(id)) names.push(then.name);
  return names;
}

/**
 * Whether a layer of `rootId`'s subtree is still as the Assistant's `state` left it, and not as the
 * person's `original` screen had it (`root` is the record's root). A layer the Assistant added isn't
 * in `original` at all, so it counts too.
 */
function assistantLeft(state: Map<Id, LayerPrint>, original: Map<Id, LayerPrint>, root: Id, current: Map<Id, LayerPrint>, rootId: Id): boolean {
  const made = root === rootId ? state : recordedSubtree(state, rootId);
  const theirs = root === rootId ? original : recordedSubtree(original, rootId);
  for (const [id, now] of current) {
    if (made.get(id)?.content === now.content && theirs.get(id)?.content !== now.content) return true;
  }
  return false;
}

export function createReplaceGuard(): ReplaceGuard {
  let records: ScreenRecord[] = [];

  const recordsOf = (docId: string, component: Id) => records.filter((r) => r.docId === docId && r.component === component);
  /** The record whose root is on `path` (a layer's ancestors and itself) nearest to its end. */
  const nearest = (docId: string, component: Id, path: readonly Id[]): ScreenRecord | null => {
    let found: ScreenRecord | null = null;
    let depth = -1;
    for (const record of recordsOf(docId, component)) {
      const at = path.indexOf(record.root);
      if (at > depth) {
        found = record;
        depth = at;
      }
    }
    return found;
  };

  return {
    check({ docId, component, replace, picked }, doc) {
      const layers = doc.components[component]?.layers;
      const loc = layers ? findLayer(layers, replace) : undefined;
      // A layer that isn't there: import_design says so itself.
      if (!loc) return null;
      const target = { id: replace, name: layerDisplayName(loc.layer) };
      const record = nearest(docId, component, loc.path);
      if (record) {
        // Against the closest version the Assistant left (the newest on a tie): the person's Undo can
        // take the screen back to any of them, and only what they changed after that counts.
        const current = printSubtree(doc, component, replace)!;
        let closest = record.states.at(-1)!;
        let changed = changesSince(closest, record.root, current, replace);
        for (const state of [...record.states].reverse().slice(1)) {
          const next = changesSince(state, record.root, current, replace);
          if (next.length < changed.length) [closest, changed] = [state, next];
        }
        if (!changed.length) return null;
        // The person's own screen that the Assistant replaced, back from their Undo (and maybe changed
        // since): with nothing of the Assistant's version left in it, it's theirs again, and asking goes
        // by what they picked, as for any screen of theirs.
        if (!record.original || assistantLeft(closest, record.original, record.root, current, replace)) {
          return { reason: "hand_edited", target, changed: [...new Set(changed)].slice(0, LISTED), changedCount: changed.length };
        }
      }
      if (picked !== null && loc.path.includes(picked)) return null;
      return { reason: "untargeted", target, changed: [], changedCount: 0 };
    },

    remember(docId, component, screenId, doc, before) {
      const layers = doc.components[component]?.layers;
      const loc = layers ? findLayer(layers, screenId) : undefined;
      const current = printSubtree(doc, component, screenId);
      if (!layers || !loc || !current) return;
      // Records for the replaced id, or of layers inside the new screen, are superseded by it.
      const superseded = (r: ScreenRecord) => r.docId === docId && r.component === component && !!findLayer(layers, r.root)?.path.includes(screenId);
      const replaced = records.find((r) => superseded(r) && r.root === screenId);
      records = records.filter((r) => !superseded(r));
      const outer = nearest(docId, component, loc.path);
      if (outer) {
        // Inside a screen the Assistant made: that screen's record takes the new layers in.
        const next = new Map(latest(outer));
        for (const id of recordedSubtree(next, screenId).keys()) next.delete(id);
        for (const [id, print] of current) next.set(id, print);
        pushState(outer, next);
        return;
      }
      // A replace keeps the screen's id, and its earlier versions: undoing it isn't the person's change.
      // The first replace of the person's own screen keeps theirs apart, as it was.
      const original = replaced ? replaced.original : before && printSubtree(before, component, screenId);
      const record: ScreenRecord = { docId, component, root: screenId, states: replaced?.states ?? [], ...(original ? { original } : {}) };
      pushState(record, current);
      records.push(record);
      if (records.length > MAX_RECORDS) records = records.slice(-MAX_RECORDS);
    },

    refresh(docId, doc, affected) {
      const components = new Set(affected.components);
      for (const record of records) {
        // Layer ids are unique only within a component, so another component's "title" isn't this one's.
        if (record.docId !== docId || !components.has(record.component)) continue;
        const current = printSubtree(doc, record.component, record.root);
        // The screen is gone for now; an undo can bring it back as the Assistant left it.
        if (!current) continue;
        const then = latest(record);
        const next = new Map(then);
        for (const id of affected.layers) {
          const print = current.get(id);
          if (print) next.set(id, print);
          else next.delete(id);
        }
        // A write elsewhere in the component leaves this screen's versions as they are.
        if (affected.layers.some((id) => !samePrint(then.get(id), next.get(id)))) pushState(record, next);
      }
    },

    tracks(docId) {
      return records.some((r) => r.docId === docId);
    },

    clear() {
      records = [];
    },
  };
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** A name from the document as copy shows it: one line, at most 80 characters. */
function shown(name: string): string {
  const line = name.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

/** "A", "A and B", "A, B and C", or the first five and ", and N more". */
function nameList(names: readonly string[], count: number): string {
  const listed = names.slice(0, LISTED).map(shown);
  const more = Math.max(0, count - listed.length);
  if (!listed.length) return plural(count, "layer");
  if (more) return `${listed.join(", ")}, and ${more} more`;
  return listed.length <= 1 ? listed.join("") : `${listed.slice(0, -1).join(", ")} and ${listed.at(-1)}`;
}

/** "Promo Badge, Old Banner, Divider", or the first five and ", and N more". */
function droppedList(impact: ReplaceImpact): string {
  const listed = impact.dropped.slice(0, LISTED).map(shown);
  const more = Math.max(0, impact.droppedCount - listed.length);
  return `${listed.join(", ")}${more ? `${listed.length ? ", and " : ""}${more} more` : ""}`;
}

const isAre = (count: number) => (count === 1 ? "isn't" : "aren't");
const connections = (impact: ReplaceImpact | null) => (impact && impact.lostConnections > 0 ? ` ${plural(impact.lostConnections, "connection")} will be removed.` : "");

/** The confirmation for a replace (kind "replace"; the decline button keeps the person's work). */
export function replacePrompt(check: ReplaceCheck, impact: ReplaceImpact | null): ConfirmPrompt {
  const name = shown(check.target.name);
  const count = impact?.droppedCount ?? 0;
  if (check.reason === "hand_edited") {
    const dropped = impact && impact.droppedCount > 0 ? `, and ${plural(impact.droppedCount, "layer")} ${isAre(impact.droppedCount)} in it: ${droppedList(impact)}` : "";
    return {
      kind: "replace",
      count,
      title: `Replace your changes to “${name}”?`,
      message: `You changed ${nameList(check.changed, check.changedCount)} after Claude made this screen. Claude's new version replaces the whole screen${dropped}.${connections(impact)} You can undo it afterwards.`,
      approveLabel: "Replace",
      declineLabel: "Keep my changes",
    };
  }
  const dropped = impact && impact.droppedCount > 0 ? ` ${plural(impact.droppedCount, "layer")} ${isAre(impact.droppedCount)} in the new version: ${droppedList(impact)}.` : "";
  return {
    kind: "replace",
    count,
    title: `Replace “${name}”?`,
    message: `Claude wants to rebuild “${name}”, which you didn't ask it to change.${dropped}${connections(impact)} You can undo it afterwards.`,
    approveLabel: "Replace",
    declineLabel: `Keep “${name}”`,
  };
}

/** The tool result Claude gets when the person keeps what's there. */
export function replaceDeclinedMessage(check: ReplaceCheck): string {
  const name = shown(check.target.name);
  return check.reason === "hand_edited"
    ? `The person kept their changes to “${name}”, so nothing changed. Import your design as a new screen instead (leave out replace), or ask them what to change.`
    : `The person kept “${name}” as it is, so nothing changed. Import your design as a new screen instead (leave out replace), or ask what they'd like.`;
}

/** The declined chip's detail: "You kept “Home”" or "You kept your changes". */
export function replaceDeclinedDetail(check: ReplaceCheck): string {
  return check.reason === "hand_edited" ? "You kept your changes" : `You kept “${shown(check.target.name)}”`;
}
