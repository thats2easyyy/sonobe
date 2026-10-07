/**
 * The Assistant's view of the editor it sits in: what's selected (the chips over the message field
 * and the context a message is sent with), an index of the prototype's names and ids (the mentions in
 * its replies), and what clicking or pointing at a name does. The drawer and its tests read the
 * `assistantEditor` store; `attachAssistantEditor` keeps it in step with an editor session while the
 * drawer is open. Without an editor (a test, the gallery) the store stays empty and the chat works as
 * it did.
 */

import { createStore } from "zustand/vanilla";
import { layoutStore } from "../../shell/layoutStore.ts";
import { currentComponentId, itemKindOf } from "../../state/selection.ts";
import type { EditorSession } from "../../state/session.ts";
import { toast } from "../../ui/Toast.tsx";
import { revealItems } from "../hud/reveal.ts";
import { showKnobs } from "../knobs/knobsStore.ts";
import { createMentionIndex, mentionKey, type MentionIndex, type MentionTarget } from "./mentions.ts";
import { selectionContext, selectionKey } from "./selectionContext.ts";
import type { AssistantSelectionContext } from "./types.ts";

export interface AssistantEditorState {
  /** What's selected in the editor, or null. */
  selection: AssistantSelectionContext | null;
  /** The prototype's names and ids, or null without an editor. */
  index: MentionIndex | null;
  /** mentionKey of each selected item, so its chips show as selected. */
  selected: ReadonlySet<string>;
  /** Show the item: select it where it lives (entering its component, opening the patch editor or the Knobs tab) and scroll to it. */
  show(target: MentionTarget): void;
  /** The item the pointer or focus is on in the chat, highlighted in the editor; null when it left. */
  point(target: MentionTarget | null): void;
}

const NONE: ReadonlySet<string> = new Set();
const EMPTY: AssistantEditorState = { selection: null, index: null, selected: NONE, show: () => undefined, point: () => undefined };

export const assistantEditor = createStore<AssistantEditorState>()(() => EMPTY);

/**
 * Select and reveal `target` in the editor, entering its component when it's in another one. A patch
 * or a comment brings the patch editor into view; a knob opens the Knobs tab on its row. False (with
 * a note to the person) when the item is gone.
 */
export function showMention(session: EditorSession, target: MentionTarget): boolean {
  if (target.kind === "knob") {
    showKnobs(session, target.id);
    return true;
  }
  const component = target.component ? session.document.getState().doc.components[target.component] : undefined;
  if (!component || itemKindOf(component, target.id) !== target.kind) {
    toast({ title: `“${target.name}” isn't in the prototype anymore`, tone: "neutral" });
    return false;
  }
  const layout = layoutStore.getState();
  if (target.kind !== "layer" && layout.viewMode === "canvas") layout.setViewMode("split");
  // The person is reading along: the graph keeps its zoom and moves only when the item isn't in view.
  return revealItems(session, target.component, [target.id], { gentle: true });
}

/** Highlight `target` where the editor shows it (the canvas, the layer list, the viewer, the patch editor), without selecting it. */
export function pointAtMention(session: EditorSession, target: MentionTarget | null): void {
  const selection = session.selection.getState();
  if (target && target.kind !== "knob" && target.component === currentComponentId(selection)) {
    selection.setHovered({ kind: target.kind, id: target.id, component: target.component, source: "assistant" });
    return;
  }
  if (selection.hovered?.source === "assistant") selection.setHovered(null);
}

/**
 * Keep `assistantEditor` in step with `session`. The index and the selection are replaced only when
 * what they say changes (a name, an id, the viewed component; the selected items), so a drag on the
 * canvas, which changes the document every frame, re-renders nothing in the chat.
 */
export function attachAssistantEditor(session: EditorSession): () => void {
  let selectionSeen: string | null = null;
  const sync = () => {
    const { doc } = session.document.getState();
    const state = session.selection.getState();
    const current = currentComponentId(state);
    const patch: Partial<AssistantEditorState> = {};

    const index = createMentionIndex({ doc, registry: session.registry, current });
    if (index.signature !== assistantEditor.getState().index?.signature) patch.index = index;

    const selection = selectionContext(doc, session.registry, state);
    const key = selection ? selectionKey(selection) : "";
    if (key !== selectionSeen) {
      selectionSeen = key;
      patch.selection = selection;
      patch.selected = selection ? new Set([...state.patches.map((id) => mentionKey({ kind: "patch", id, component: current })), ...state.layers.map((id) => mentionKey({ kind: "layer", id, component: current })), ...state.comments.map((id) => mentionKey({ kind: "comment", id, component: current }))]) : NONE;
    }
    if (Object.keys(patch).length) assistantEditor.setState(patch);
  };
  assistantEditor.setState({ show: (target) => void showMention(session, target), point: (target) => pointAtMention(session, target) });
  sync();
  const stopDocument = session.document.subscribe((s, previous) => {
    if (s.doc !== previous.doc) sync();
  });
  const stopSelection = session.selection.subscribe((s, previous) => {
    if (s.layers !== previous.layers || s.patches !== previous.patches || s.comments !== previous.comments || s.componentPath !== previous.componentPath) sync();
  });
  return () => {
    stopDocument();
    stopSelection();
    pointAtMention(session, null);
    assistantEditor.setState(EMPTY, true);
  };
}
