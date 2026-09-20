/**
 * Knobs and presets in the editor (ARCHITECTURE §9): the Inspector's Knobs tab (KnobsPanel), the
 * control a knob-driven Inspector field shows (KnobControl), Make Knob (MakeKnobPopover), the app's
 * knob commands, and the per-session UI store (the partner preset, filters, the row to flash).
 */

export { knobCommands, FLIP_PRESETS_COMMAND, SHOW_KNOBS_COMMAND } from "./commands.ts";
export { KnobControl, type KnobControlProps } from "./KnobControl.tsx";
export { copyDifferences, KnobsPanel } from "./KnobsPanel.tsx";
export { knobsUi, showKnobs, useKnobsUi, type KnobsRequest, type KnobsUiState, type KnobsUiStore } from "./knobsStore.ts";
export { MakeKnobPopover } from "./MakeKnobPopover.tsx";
export * from "./model.ts";
export { knobEdit, useKnobEdit, type KnobEdit } from "./useKnobEdit.ts";
