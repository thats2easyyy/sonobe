/** The Design with Claude commands for the command palette: design a new screen, or redesign the selected layer. */

import type { EditorSession } from "../../state/session.ts";
import type { Command } from "../../ui/commands/commandRegistry.ts";

/** ai.design and ai.redesign; both open the canvas's Design with Claude box. */
export function designCommands(_session: EditorSession): Command[] {
  throw new Error("not implemented");
}
