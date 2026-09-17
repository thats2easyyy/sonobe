/** The Assistant command for the command palette and the native View → Assistant menu item. */

import { Sparkles } from "lucide-react";
import type { Command } from "../../ui/commands/commandRegistry.ts";
import { assistantStore } from "./assistantStore.ts";

/** DESKTOP_COMMAND_MAP routes the native "view.toggleAssistant" menu item to this id. */
export const ASSISTANT_COMMAND_ID = "ai.assistant";

export function assistantCommand(toggle: () => void = () => assistantStore.getState().toggle()): Command {
  return {
    id: ASSISTANT_COMMAND_ID,
    title: "Assistant",
    category: "Help",
    description: "Chat with Claude inside Sonobe using your own Anthropic API key",
    keywords: ["ai", "chat", "claude", "api key", "anthropic", "build", "help me"],
    icon: Sparkles,
    run: () => toggle(),
  };
}
