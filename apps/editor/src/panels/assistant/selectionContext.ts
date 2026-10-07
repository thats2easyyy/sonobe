/**
 * What the Assistant's chat knows about the editor's selection: the context a message is sent with
 * (the chips over the message field), and the questions one press asks about it. DOM-free.
 */

import type { Registry, SonobeDocument } from "@sonobe/core";
import { currentComponentId, type SelectionState } from "../../state/selection.ts";
import { itemTarget } from "./mentions.ts";
import type { AssistantSelectionContext, AssistantSelectionItem } from "./types.ts";

/** Items a message lists; the rest are counted (the desktop caps it the same way). */
export const MAX_SELECTION_ITEMS = 50;

/** The selected patches, layers and comments that still exist, in that order, or null when nothing is selected. */
export function selectionContext(doc: SonobeDocument, registry: Registry, selection: Pick<SelectionState, "componentPath" | "layers" | "patches" | "comments">): AssistantSelectionContext | null {
  const componentId = currentComponentId(selection);
  const component = doc.components[componentId];
  if (!component) return null;
  const items: AssistantSelectionItem[] = [];
  for (const id of [...selection.patches, ...selection.layers, ...selection.comments]) {
    const target = itemTarget({ registry }, component, id);
    if (target && target.kind !== "knob") items.push({ kind: target.kind, id, name: target.name, ...(target.type ? { type: target.type } : {}) });
  }
  if (items.length === 0) return null;
  const listed = items.slice(0, MAX_SELECTION_ITEMS);
  return { component: { id: componentId, name: component.name }, items: listed, ...(items.length > listed.length ? { more: items.length - listed.length } : {}) };
}

/** How many items the selection has, listed or not. */
export const selectionCount = (context: AssistantSelectionContext): number => context.items.length + (context.more ?? 0);

/** The same items with the same names in the same component have the same key. */
export function selectionKey(context: AssistantSelectionContext): string {
  return `${context.component.id}\n${context.items.map((i) => `${i.kind[0]}:${i.id}:${i.type ?? ""}:${i.name}`).join("\n")}\n${context.more ?? 0}`;
}

/** What Explain asks about the selection. */
export function explainPrompt(context: AssistantSelectionContext): string {
  return selectionCount(context) === 1 ? "What does this do, and how does it work?" : "What do these do, and how do they work together?";
}

/** Starter questions for an empty chat while something is selected. */
export function selectionStarters(context: AssistantSelectionContext): string[] {
  return selectionCount(context) === 1 ? ["What does this do?", "How does this work?", "What's happening here?"] : ["What do these do?", "How do these work together?", "What's happening here?"];
}

/** "Flight Timer", "Flight Timer and Flight Easing", "Flight Timer, Flight Easing and 3 more": the selection in words (labels for screen readers). */
export function selectionLabel(context: AssistantSelectionContext): string {
  const names = context.items.map((i) => i.name);
  const total = selectionCount(context);
  if (total === 1) return names[0]!;
  if (total === 2 && names.length === 2) return `${names[0]} and ${names[1]}`;
  const shown = names.slice(0, 2);
  return `${shown.join(", ")} and ${total - shown.length} more`;
}
