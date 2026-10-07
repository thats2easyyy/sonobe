/**
 * Mentions: the names of layers, patches, comments and knobs in the Assistant's replies, which the
 * person clicks to see that item in the editor. The Assistant writes a name as a link to its id
 * ("[Flight Timer](#flight_timer)", "[Level Line](#@level_line)", "[Flight Time](#$knob.flight_time)":
 * the desktop's SELECTION_GUIDE says so), and a name it left plain is found by the name itself, when
 * exactly one item has it. Everything resolves against the document as it is now, so a mention of an
 * item that's gone is plain text again. DOM-free.
 */

import { allLayers, findLayer, getKnob, getPatchSpec, LAYER_TYPE_MAP, listComponentIds, type Component, type Id, type LayerNode, type PatchCategory, type Registry, type SonobeDocument } from "@sonobe/core";
import type { MdBlock, MdInline } from "../learn/markdown.ts";

export type MentionKind = "layer" | "patch" | "comment" | "knob";

export interface MentionTarget {
  kind: MentionKind;
  id: Id;
  /** The component a layer, patch or comment is in. A knob belongs to the prototype. */
  component?: Id;
  /** Its display name (a comment's first line). */
  name: string;
  /** The patch's or layer's type key. */
  type?: string;
  /** The type's display name ("Wait", "Rectangle"). */
  typeName?: string;
  /** A patch's category, for its dot. */
  category?: PatchCategory;
}

/** What `resolve` needs to know about where the person is. */
export interface MentionScope {
  doc: SonobeDocument;
  registry: Registry;
  /** The component the person is viewing: its items win when an id or a name is in several. */
  current: Id;
}

const KNOB_PREFIX = "$knob.";
const MAX_COMMENT_NAME = 60;

/** A comment's name: its first line, cut. */
export function commentName(text: string): string {
  const line = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (!line) return "Comment";
  return line.length > MAX_COMMENT_NAME ? `${line.slice(0, MAX_COMMENT_NAME - 1).trimEnd()}…` : line;
}

function patchTarget(registry: Registry, component: Component, id: Id): MentionTarget | null {
  const patch = component.patches[id];
  if (!patch) return null;
  const spec = getPatchSpec(registry, patch.type);
  return { kind: "patch", id, component: component.id, name: patch.name || spec?.name || id, type: patch.type, ...(spec ? { typeName: spec.name, category: spec.category } : {}) };
}

function layerTarget(component: Component, layer: LayerNode): MentionTarget {
  const typeName = LAYER_TYPE_MAP.get(layer.type)?.name;
  return { kind: "layer", id: layer.id, component: component.id, name: layer.name || layer.id, type: layer.type, ...(typeName ? { typeName } : {}) };
}

/** The item `id` names in `component`, as a target. */
export function itemTarget(scope: Pick<MentionScope, "registry">, component: Component, id: Id): MentionTarget | null {
  const patch = patchTarget(scope.registry, component, id);
  if (patch) return patch;
  const layer = findLayer(component.layers, id)?.layer;
  if (layer) return layerTarget(component, layer);
  const comment = component.comments.find((c) => c.id === id);
  if (comment) return { kind: "comment", id, component: component.id, name: commentName(comment.text) };
  return null;
}

/** The component an instance (a component patch, or a component instance layer) in `component` shows. */
function instanceTarget(doc: SonobeDocument, component: Component, id: Id): Component | undefined {
  const target = component.patches[id]?.component ?? findLayer(component.layers, id)?.layer.component;
  return target ? doc.components[target] : undefined;
}

/** The components to look in, the one being viewed first, then the root, then the rest. */
function searchOrder(scope: MentionScope): Component[] {
  const { doc } = scope;
  const ids = [...new Set([scope.current, doc.project.root, ...listComponentIds(doc)])];
  return ids.flatMap((id) => doc.components[id] ?? []);
}

/**
 * What a mention's target names in the document, or null: "#flight_timer" (a patch or a comment),
 * "#@level_line" (a layer; the "@" is optional), "#$knob.flight_time" (a knob), and for an item inside a
 * component "#swipe_card/tilt" (the component's id, or an instance path such as "#card_1/tilt"). A port
 * address ("#flight_timer.progress") names its patch.
 */
export function resolveMention(scope: MentionScope, href: string): MentionTarget | null {
  if (!href.startsWith("#")) return null;
  let raw: string;
  try {
    raw = decodeURIComponent(href.slice(1)).trim();
  } catch {
    return null;
  }
  if (!raw) return null;
  const { doc } = scope;
  if (raw.startsWith(KNOB_PREFIX)) {
    const knob = getKnob(doc.knobs, raw.slice(KNOB_PREFIX.length));
    return knob ? { kind: "knob", id: knob.id, name: knob.name } : null;
  }
  const path = raw.split("/");
  // "tap_card.tap" names a port and "row#2" a copy: the mention shows the item.
  const id = path.pop()!.replace(/^@/, "").split(/[.#]/)[0]!;
  if (!id) return null;
  if (path.length) {
    for (const start of [doc.components[path[0]!], ...searchOrder(scope)]) {
      if (!start) continue;
      let component: Component | undefined = start;
      // A path that starts with a component's id starts inside it; any other step is an instance to go into.
      for (const step of start.id === path[0] ? path.slice(1) : path) component = component && instanceTarget(doc, component, step.replace(/^@/, ""));
      const found = component && itemTarget(scope, component, id);
      if (found) return found;
    }
  }
  for (const component of searchOrder(scope)) {
    const found = itemTarget(scope, component, id);
    if (found) return found;
  }
  return null;
}

/** The target as a link's target: what resolveMention reads back to the same item. */
export function mentionHref(target: MentionTarget, current: Id): string {
  if (target.kind === "knob") return `#${KNOB_PREFIX}${target.id}`;
  const id = target.kind === "layer" ? `@${target.id}` : target.id;
  return target.component && target.component !== current ? `#${target.component}/${id}` : `#${id}`;
}

/** Stable identity for a target (React keys, "is it selected"). */
export const mentionKey = (target: Pick<MentionTarget, "kind" | "id" | "component">): string => `${target.kind}:${target.component ?? ""}:${target.id}`;

// ---------------------------------------------------------------------------
// The index: targets by id, and names that name exactly one thing.
// ---------------------------------------------------------------------------

export interface MentionIndex {
  readonly scope: MentionScope;
  /** resolveMention against the index's document. */
  resolve(href: string): MentionTarget | null;
  /** Layers, patches and comments by a display name only one of them has (the viewed component's first). */
  readonly items: ReadonlyMap<string, MentionTarget>;
  /** Knobs by name. */
  readonly knobs: ReadonlyMap<string, MentionTarget>;
  /** Matches any indexed name as a whole word, longest first; null when there are none. */
  readonly pattern: RegExp | null;
  /** Changes when a name, an id or the viewed component does: two indexes with one signature link the same text the same way. */
  readonly signature: string;
}

/** Names this short, or with no letter in them, are never found by name ("1", "OK", "–"). */
const nameable = (name: string): boolean => name.length >= 3 && /\p{L}/u.test(name);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every patch and layer of a component, patches first. Comments are found by id alone. */
function componentTargets(scope: Pick<MentionScope, "registry">, component: Component): MentionTarget[] {
  const out: MentionTarget[] = [];
  for (const id of Object.keys(component.patches)) out.push(patchTarget(scope.registry, component, id)!);
  for (const layer of allLayers(component.layers)) out.push(layerTarget(component, layer));
  return out;
}

export function createMentionIndex(scope: MentionScope): MentionIndex {
  const { doc } = scope;
  // A name that two items of one component share: the name alone can't say which, here or further away.
  const shared = new Set<string>();
  const items = new Map<string, MentionTarget>();
  const parts: string[] = [scope.current];
  // The viewed component's names first: a name it has once wins over the same name elsewhere.
  for (const component of searchOrder(scope)) {
    const here = new Map<string, MentionTarget | null>();
    for (const target of componentTargets(scope, component)) {
      // An instance's component is part of where a path leads.
      parts.push(`${component.id}/${target.kind[0]}:${target.id}:${target.type ?? ""}:${component.patches[target.id]?.component ?? ""}=${target.name}`);
      if (nameable(target.name)) here.set(target.name, here.has(target.name) ? null : target);
    }
    for (const comment of component.comments) parts.push(`${component.id}/c:${comment.id}=${commentName(comment.text)}`);
    for (const [name, target] of here) {
      if (items.has(name) || shared.has(name)) continue;
      if (target) items.set(name, target);
      else shared.add(name);
    }
  }
  const knobs = new Map<string, MentionTarget>();
  for (const knob of doc.knobs?.knobs ?? []) {
    parts.push(`$:${knob.id}=${knob.name}`);
    if (nameable(knob.name)) knobs.set(knob.name, { kind: "knob", id: knob.id, name: knob.name });
  }
  // Compiled on first use: an index is made on every document change, and most are never matched against.
  let pattern: RegExp | null | undefined;
  return {
    scope,
    resolve: (href) => resolveMention(scope, href),
    items,
    knobs,
    get pattern() {
      if (pattern === undefined) {
        const names = [...new Set([...items.keys(), ...knobs.keys()])].sort((a, b) => b.length - a.length || a.localeCompare(b));
        pattern = names.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${names.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}_])`, "gu") : null;
      }
      return pattern;
    },
    signature: parts.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Linking a reply's Markdown.
// ---------------------------------------------------------------------------

const flatText = (nodes: readonly MdInline[]): string => nodes.map((n) => (n.type === "text" || n.type === "code" ? n.text : n.type === "break" ? " " : flatText(n.children))).join("");
const bare = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** One-word names are common words too ("Roll", "Flash", "Tap"), so they count only where the text marks them as a name. */
const KIND_WORD = /^\s+(?:patch|layer|knob)\b/i;
const OPEN_QUOTE = /["“‘']$/;
const CLOSE_QUOTE = /^["”’']/;

/** The text nodes and links `text` becomes once the names in it are links. `emphasized`: the text is the whole of a bold or italic run. */
function linkNames(text: string, index: MentionIndex, emphasized: boolean): MdInline[] {
  const { pattern } = index;
  if (!pattern) return [{ type: "text", text }];
  const out: MdInline[] = [];
  let from = 0;
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const name = match[0];
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + name.length);
    const knob = index.knobs.get(name);
    const item = index.items.get(name);
    // "the Shutter Haptic knob" names the knob even when a patch has the name too.
    const target = knob && (!item || /^\s+knob\b/i.test(after)) ? knob : item;
    if (!target) continue;
    const marked = /\s/.test(name) || (emphasized && text.trim() === name) || KIND_WORD.test(after) || (OPEN_QUOTE.test(before) && CLOSE_QUOTE.test(after));
    if (!marked) continue;
    if (match.index > from) out.push({ type: "text", text: text.slice(from, match.index) });
    out.push({ type: "link", href: mentionHref(target, index.scope.current), children: [{ type: "text", text: name }] });
    from = match.index + name.length;
  }
  if (from === 0) return [{ type: "text", text }];
  if (from < text.length) out.push({ type: "text", text: text.slice(from) });
  return out;
}

function linkInlines(nodes: readonly MdInline[], index: MentionIndex, emphasized = false): MdInline[] {
  return nodes.flatMap((node): MdInline[] => {
    switch (node.type) {
      case "text":
        return linkNames(node.text, index, emphasized && nodes.length === 1);
      case "strong":
      case "em":
        return [{ ...node, children: linkInlines(node.children, index, true) }];
      case "del":
        return [{ ...node, children: linkInlines(node.children, index) }];
      case "link": {
        if (!node.href?.startsWith("#")) return [node];
        const target = index.resolve(node.href);
        // A mention of something that isn't in the document reads as the plain text it is.
        if (!target) return node.children;
        // The Assistant sometimes shows the id it linked ("flight_ease"): the person reads the name.
        const label = flatText(node.children).trim();
        const children: MdInline[] = bare(label) === bare(target.id) && label !== target.name ? [{ type: "text", text: target.name }] : node.children;
        return [{ type: "link", href: mentionHref(target, index.scope.current), children }];
      }
      default:
        return [node];
    }
  });
}

/** A reply's blocks with its mentions as links the transcript draws as chips: the ones the Assistant linked, and names found by name. Code is left alone. */
export function linkMentions(blocks: readonly MdBlock[], index: MentionIndex): MdBlock[] {
  return blocks.map((block): MdBlock => {
    switch (block.type) {
      case "heading":
      case "paragraph":
        return { ...block, children: linkInlines(block.children, index) };
      case "list":
        return { ...block, items: block.items.map((item) => linkMentions(item, index)) };
      case "table":
        return { ...block, head: block.head.map((cell) => linkInlines(cell, index)), rows: block.rows.map((row) => row.map((cell) => linkInlines(cell, index))) };
      case "blockquote":
        return { ...block, children: linkMentions(block.children, index) };
      default:
        return block;
    }
  });
}

/**
 * A reply's text while it streams, without a link that's only half written at its end
 * ("…feeds [Flight Eas" or "…feeds [Flight Easing](#flight_"), which would flash as raw Markdown.
 */
export function withoutOpenLink(text: string): string {
  return text.replace(/\[[^\][\n]*(?:\]\([^)\n]*)?$/, "");
}
