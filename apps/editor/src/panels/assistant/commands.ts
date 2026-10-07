/** The Assistant's commands for the command palette, menus and the native View → Assistant item. */

import { Sparkles } from "lucide-react";
import type { StoreApi } from "zustand/vanilla";
import type { EditorSession } from "../../state/session.ts";
import type { Command } from "../../ui/commands/commandRegistry.ts";
import { assistantStore, type AssistantState } from "./assistantStore.ts";
import { sharedAssistantController, type AssistantController } from "./controller.ts";
import { providerReady, subscriptionSwitchedOff } from "./provider.ts";
import { explainPrompt, selectionContext } from "./selectionContext.ts";
import type { AssistantSelectionContext } from "./types.ts";

/** DESKTOP_COMMAND_MAP routes the native "view.toggleAssistant" menu item to this id. */
export const ASSISTANT_COMMAND_ID = "ai.assistant";

/** Explain with Claude: the patch editor's and the layer list's menus run it by this id. */
export const EXPLAIN_COMMAND_ID = "ai.explain";

export function assistantCommand(toggle: () => void = () => assistantStore.getState().toggle()): Command {
  return {
    id: ASSISTANT_COMMAND_ID,
    title: "Assistant",
    category: "View",
    shortcut: "Mod+6",
    allowInInput: true,
    description: "Chat with Claude inside Sonobe using your own Anthropic API key",
    keywords: ["ai", "chat", "claude", "api key", "anthropic", "build", "help me"],
    icon: Sparkles,
    run: () => toggle(),
  };
}

/** Send Explain's question, once the chat can take it. */
async function askAbout(selection: AssistantSelectionContext, store: StoreApi<AssistantState>, controller: AssistantController): Promise<void> {
  // One reply at a time.
  if (store.getState().running) return;
  // What the chat runs on isn't known until its status has been read once (the drawer reads it as it opens).
  if (store.getState().status === null) await controller.refresh();
  const { status, running } = store.getState();
  // Not set up (no key, not signed in): the drawer shows its setup, and the question would only come back as an error.
  if (running || !status || !(providerReady(status) || subscriptionSwitchedOff(status))) return;
  await controller.send(explainPrompt(selection), { selection });
}

/**
 * Open the Assistant and ask what the selected layers, patches and comments do. The message goes with
 * the selection, as one typed in the chat would. While a reply is running, or before the Assistant is
 * set up, the chat only opens: the selection waits over the message field. Returns whether there was a
 * selection to ask about.
 */
export function explainSelection(session: EditorSession, options: { store?: StoreApi<AssistantState>; controller?: AssistantController } = {}): boolean {
  const selection = selectionContext(session.document.getState().doc, session.registry, session.selection.getState());
  if (!selection) return false;
  const store = options.store ?? assistantStore;
  // An earlier × took this selection off the message; asking about it puts it back.
  store.getState().setSelectionOff(null);
  store.getState().ask();
  void askAbout(selection, store, options.controller ?? sharedAssistantController());
  return true;
}

export function explainCommand(session: EditorSession): Command {
  return {
    id: EXPLAIN_COMMAND_ID,
    title: "Explain with Claude",
    category: "Help",
    shortcut: "Mod+E",
    description: "Ask the Assistant what the selected layers and patches do",
    keywords: ["ai", "assistant", "ask", "chat", "what does this do", "how does this work", "describe", "understand", "why"],
    icon: Sparkles,
    when: () => selectionContext(session.document.getState().doc, session.registry, session.selection.getState()) !== null,
    disabledReason: "Select a layer or a patch first",
    run: () => void explainSelection(session),
  };
}
