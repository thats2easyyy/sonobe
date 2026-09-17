/**
 * Undo and Redo titles that say what they'll revert, like native macOS apps and Origami: "Undo Mute
 * Card Shadow", or "Undo Claude: renamed shadow" for an agent's change. Pure; the palette, the toast
 * after ⌘Z, and the desktop Edit menu use them.
 */

/** Longest title a menu shows before trimming with an ellipsis. */
export const MAX_UNDO_TITLE = 40;

/** A history description without "You: " (your own changes) and without the " (12 ops)" count. */
export function historyAction(description: string): string {
  const text = description.replace(/\s\(\d+ ops\)$/, "").trim();
  return text.startsWith("You: ") ? text.slice("You: ".length) : text;
}

/** "Undo" when there's nothing to revert, otherwise "Undo Mute Card Shadow". */
export function undoMenuTitle(verb: "Undo" | "Redo", description: string | null | undefined, max = MAX_UNDO_TITLE): string {
  const action = description ? historyAction(description) : "";
  if (!action) return verb;
  const title = `${verb} ${action}`;
  return title.length <= max ? title : `${title.slice(0, max - 1).trimEnd()}…`;
}

/** "Undid Mute Card Shadow" / "Redid Mute Card Shadow", for the status toast after a step. */
export function historyStepTitle(verb: "Undo" | "Redo", description: string): string {
  const action = historyAction(description);
  return `${verb === "Undo" ? "Undid" : "Redid"}${action ? ` ${action}` : " a change"}`;
}
