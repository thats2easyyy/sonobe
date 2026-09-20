/**
 * The Knobs tab's preset bar: one chip per preset (the running one filled, locked ones with a lock),
 * + for a new preset copied from the running one, and the tab's ⋯ menu. A chip's context menu
 * renames, locks or deletes it. With a single preset the bar offers only "Add Preset to Compare".
 */

import { deriveKnobPresetId, type KnobPreset, type KnobSet, type Op } from "@sonobe/core";
import { Ellipsis, Lock, LockOpen, Pencil, Plus, Trash2 } from "lucide-react";
import type { CSSProperties, KeyboardEvent, Ref } from "react";
import { useEditorSession } from "../../state/EditorProvider.tsx";
import type { EditorSession } from "../../state/session.ts";
import { newPresetLabel } from "../../state/undoLabels.ts";
import { Button } from "../../ui/Button.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { ContextMenu, Menu, type MenuEntry } from "../../ui/Menu.tsx";
import { newPresetName, presetColor } from "./model.ts";
import type { KnobEdit } from "./useKnobEdit.ts";

/** Rename, lock or unlock, and delete a preset (a chip's menu, and the ⋯ menu for the running one). */
export function presetEntries(session: EditorSession, edit: KnobEdit, set: KnobSet, preset: KnobPreset, withNames = false): MenuEntry[] {
  const suffix = withNames ? ` “${preset.name}”` : "";
  const last = set.presets.length === 1 && set.knobs.length > 0;
  return [
    {
      id: `rename:${preset.id}`,
      label: `Rename${suffix}…`,
      icon: <Pencil size={14} />,
      onSelect: () => void renamePreset(session, edit, set, preset),
    },
    {
      id: `lock:${preset.id}`,
      label: preset.locked ? `Unlock${suffix}` : `Lock${suffix}`,
      icon: preset.locked ? <LockOpen size={14} /> : <Lock size={14} />,
      description: preset.locked ? undefined : "Its values can't be tuned by accident",
      onSelect: () => edit.apply([{ op: "updateKnobPreset", id: preset.id, locked: !preset.locked }], `${preset.locked ? "Unlock" : "Lock"} Preset “${preset.name}”`),
    },
    {
      id: `delete:${preset.id}`,
      label: `Delete${suffix}`,
      icon: <Trash2 size={14} />,
      danger: true,
      disabled: last || !!preset.locked,
      ...(preset.locked ? { description: "Unlock it first" } : last ? { description: "Every knob keeps its values in a preset" } : {}),
      onSelect: () => void deletePreset(session, edit, preset),
    },
  ];
}

async function renamePreset(session: EditorSession, edit: KnobEdit, set: KnobSet, preset: KnobPreset): Promise<void> {
  const name = await session.dialogs.prompt({
    title: "Rename Preset",
    defaultValue: preset.name,
    label: "Preset name",
    confirmLabel: "Rename",
    validate: (value) => {
      const text = value.trim();
      if (!text) return "A preset needs a name.";
      if (text.length > 40) return "Preset names are at most 40 characters.";
      if (set.presets.some((p) => p.id !== preset.id && p.name.toLowerCase() === text.toLowerCase())) return `There's already a preset named “${text}”.`;
      return null;
    },
  });
  if (name === null || name.trim() === preset.name) return;
  edit.apply([{ op: "updateKnobPreset", id: preset.id, name: name.trim() }], `Rename Preset “${preset.name}” to “${name.trim()}”`);
}

async function deletePreset(session: EditorSession, edit: KnobEdit, preset: KnobPreset): Promise<void> {
  const ok = await session.dialogs.confirm({ title: `Delete “${preset.name}”?`, message: "Its value for every knob goes with it. You can undo this.", confirmLabel: "Delete", danger: true });
  if (ok) edit.apply([{ op: "removeKnobPreset", id: preset.id }], `Delete Preset “${preset.name}”`);
}

/**
 * New Preset: a copy of the running preset's values that runs from then on, so tuning goes into the
 * copy and the preset it came from stays as it was. One undo step.
 */
export function addPreset(session: EditorSession, edit: KnobEdit, set: KnobSet | undefined): void {
  const name = newPresetName(set);
  const seen = new Set(session.document.getState().seenIds().presets);
  const id = deriveKnobPresetId(set, name, (p) => seen.has(p));
  const ops: Op[] = [{ op: "addKnobPreset", preset: { id, name }, ...(set ? { copyFrom: set.active } : {}) }];
  if (set) ops.push({ op: "applyKnobPreset", id });
  edit.apply(ops, newPresetLabel(name));
}

export interface PresetBarProps {
  set: KnobSet;
  edit: KnobEdit;
  /** The ⋯ menu's entries. */
  menu: () => readonly MenuEntry[];
  menuRef?: Ref<HTMLButtonElement>;
}

export function PresetBar({ set, edit, menu, menuRef }: PresetBarProps) {
  const session = useEditorSession();
  const single = set.presets.length === 1;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = set.presets[(index + step + set.presets.length) % set.presets.length]!;
    edit.switchPreset(next.id);
    (event.currentTarget.parentElement?.querySelector(`[data-preset="${next.id}"]`) as HTMLElement | null)?.focus();
  };
  const more = (
    <Menu aria-label="Knob options" placement="bottom-end" entries={menu}>
      <IconButton ref={menuRef} size="xs" icon={<Ellipsis size={13} />} label="Knob options" />
    </Menu>
  );
  if (single) {
    return (
      <div className="sb-knobs-presets" data-single="">
        <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => addPreset(session, edit, set)}>
          Add Preset to Compare
        </Button>
        <span className="sb-knobs-presets__spacer" />
        {more}
      </div>
    );
  }
  return (
    <div className="sb-knobs-presets">
      <div className="sb-knobs-presets__chips" role="radiogroup" aria-label="Presets">
        {set.presets.map((preset, index) => (
          <PresetChip key={preset.id} set={set} preset={preset} entries={() => presetEntries(session, edit, set, preset)} onSelect={() => edit.switchPreset(preset.id)} onKeyDown={(event) => onKeyDown(event, index)} />
        ))}
        <IconButton size="xs" icon={<Plus size={13} />} label="New Preset" tooltip="New preset from the running one" onClick={() => addPreset(session, edit, set)} />
      </div>
      {more}
    </div>
  );
}

function PresetChip({ set, preset, entries, onSelect, onKeyDown }: { set: KnobSet; preset: KnobPreset; entries: () => MenuEntry[]; onSelect: () => void; onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void }) {
  const running = preset.id === set.active;
  return (
    <ContextMenu entries={entries}>
      <div
        role="radio"
        tabIndex={running ? 0 : -1}
        aria-checked={running}
        data-preset={preset.id}
        className="sb-preset-chip"
        data-running={running || undefined}
        data-locked={preset.locked || undefined}
        style={{ "--sb-preset-color": presetColor(set, preset.id) } as CSSProperties}
        title={`${running ? `Running ${preset.name}` : `Run ${preset.name}`}${preset.locked ? " (locked)" : ""}. Right-click to rename, lock or delete.`}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
            return;
          }
          onKeyDown(event);
        }}
      >
        <span className="sb-preset-chip__dot" aria-hidden />
        <span className="sb-preset-chip__name">{preset.name}</span>
        {preset.locked && <Lock size={10} strokeWidth={2.25} aria-label="locked" />}
      </div>
    </ContextMenu>
  );
}
