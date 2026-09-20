/**
 * Knob commands for the palette and shortcuts: Show Knobs (Mod+5, also the desktop View menu),
 * Flip Presets (Mod+'), New Knob…, New Preset, Copy Knob Differences, and Convert Variables to
 * Knobs…. The app registers them, so they work while the Knobs tab is closed.
 */

import { planVariablesToKnobs } from "@sonobe/core";
import { ArrowLeftRight, ClipboardCopy, Plus, SlidersHorizontal, WandSparkles } from "lucide-react";
import type { EditorSession } from "../../state/session.ts";
import type { Command } from "../../ui/commands/commandRegistry.ts";
import { copyDifferences } from "./KnobsPanel.tsx";
import { knobsUi, showKnobs } from "./knobsStore.ts";
import { partnerPreset } from "./model.ts";
import { addPreset } from "./PresetBar.tsx";
import { knobEdit } from "./useKnobEdit.ts";

export const SHOW_KNOBS_COMMAND = "view.showKnobs";
export const FLIP_PRESETS_COMMAND = "knobs.flipPresets";

export function knobCommands(session: EditorSession): Command[] {
  // Start following preset switches now, so Flip Presets knows the one that ran before.
  knobsUi(session);
  const set = () => session.document.getState().doc.knobs;
  const partner = () => partnerPreset(set(), knobsUi(session).getState().partner);
  return [
    { id: SHOW_KNOBS_COMMAND, title: "Show Knobs", category: "View", shortcut: "Mod+5", icon: SlidersHorizontal, keywords: ["tune", "presets", "sliders", "dials", "parameters"], run: () => showKnobs(session) },
    {
      id: FLIP_PRESETS_COMMAND,
      title: "Flip Presets",
      category: "Prototype",
      description: "Run the preset that ran before, to compare",
      shortcut: "Mod+'",
      icon: ArrowLeftRight,
      keywords: ["knobs", "compare", "switch preset", "shipped", "proposal", "a/b"],
      when: () => partner() !== null,
      disabledReason: "Add a second preset to compare",
      run: () => {
        const other = partner();
        if (other) knobEdit(session).switchPreset(other);
      },
    },
    { id: "knobs.newKnob", title: "New Knob…", category: "Prototype", icon: Plus, keywords: ["knobs", "slider", "parameter", "tune"], run: () => showKnobs(session, undefined, { kind: "newKnob" }) },
    { id: "knobs.newPreset", title: "New Preset", category: "Prototype", icon: Plus, keywords: ["knobs", "compare", "variant"], run: () => addPreset(knobEdit(session), set()) },
    {
      id: "knobs.copyDifferences",
      title: "Copy Knob Differences",
      category: "Prototype",
      icon: ClipboardCopy,
      keywords: ["knobs", "presets", "handoff", "engineer", "table", "markdown"],
      when: () => partner() !== null,
      disabledReason: "Add a second preset to compare",
      run: () => {
        const knobs = set();
        const other = partner();
        if (knobs && other) copyDifferences(knobs, other);
      },
    },
    {
      id: "knobs.convertVariables",
      title: "Convert Variables to Knobs…",
      category: "Prototype",
      icon: WandSparkles,
      keywords: ["knobs", "variable broadcaster", "receiver", "constants"],
      when: () => planVariablesToKnobs(session.document.getState().doc, session.registry).knobs.length > 0,
      disabledReason: "No Variable Broadcaster shares a constant",
      run: () => showKnobs(session, undefined, { kind: "convert" }),
    },
  ];
}
