/** The Connect Claude command for the command palette and the Help menu (desktop "help.connectClaude" maps to it). */

import { Plug } from "lucide-react";
import type { Command } from "../../ui/commands/commandRegistry.ts";
import { connectClaudeStore } from "./connectStore.ts";

/** DESKTOP_COMMAND_MAP routes the native Help → Connect Claude menu item here. */
export const CONNECT_CLAUDE_COMMAND_ID = "ai.connectClaude";

export function connectClaudeCommand(open: () => void = () => connectClaudeStore.getState().show()): Command {
  return {
    id: CONNECT_CLAUDE_COMMAND_ID,
    title: "Connect Claude…",
    category: "AI",
    description: "Use Claude Desktop or Claude Code with your own plan",
    keywords: ["mcp", "claude desktop", "claude code", "setup", "connect", "ai"],
    icon: Plug,
    run: () => open(),
  };
}
