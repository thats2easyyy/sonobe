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

// Knob edits (the Knobs tab, Make Knob and Use Knob in the Inspector).

/** "Make Knob “Damping Fraction”" */
export const makeKnobLabel = (name: string): string => `Make Knob “${name}”`;

/** "Tune Commit Distance to 110 pt (Proposal)": a slider drag or scrub, one step however long it lasts. */
export const tuneKnobLabel = (knob: string, value: string, preset: string): string => `Tune ${knob} to ${value} (${preset})`;

/** A run of preset switches, one step until another edit. */
export const SWITCH_PRESETS_LABEL = "Switch Presets";

/** "New Preset “Proposal 2”" */
export const newPresetLabel = (name: string): string => `New Preset “${name}”`;

/** "Remove Knob “Commit Distance”" */
export const removeKnobLabel = (name: string): string => `Remove Knob “${name}”`;

/** "Convert 14 Variables to Knobs" */
export const convertVariablesLabel = (count: number): string => `Convert ${count} ${count === 1 ? "Variable" : "Variables"} to Knobs`;
