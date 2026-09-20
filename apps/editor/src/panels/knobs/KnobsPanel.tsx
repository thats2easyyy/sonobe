/**
 * The Inspector's Knobs tab: the project's knobs in one place, grouped, with the preset bar above
 * them. Tuning a row edits the running preset live (no restart), ticks and ≠ marks compare it with
 * the partner preset, and a locked preset's rows are read-only. The tab stays put as the selection
 * changes; a line at the top leads back to Properties.
 */

import { knobDifferencesMarkdown, type Id, type KnobSet } from "@sonobe/core";
import { ChevronDown, ChevronRight, Lock, Plus, SlidersHorizontal, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { layoutStore } from "../../shell/layoutStore.ts";
import { useDocument, useEditorSession, useSelection } from "../../state/EditorProvider.tsx";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import type { MenuEntry } from "../../ui/Menu.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Checkbox } from "../../ui/Toggle.tsx";
import { getFocusable } from "../../ui/lib/focus.ts";
import { ConvertVariablesDialog, useVariableCandidates } from "./ConvertVariablesDialog.tsx";
import { KnobEditPopover, type KnobEditTarget } from "./KnobEditPopover.tsx";
import { KnobRow } from "./KnobRow.tsx";
import { knobsUi, useKnobsUi } from "./knobsStore.ts";
import { differenceCount, knobGroups, knobUses, partnerPreset, presetName } from "./model.ts";
import { addPreset, PresetBar, presetEntries } from "./PresetBar.tsx";
import { useKnobEdit } from "./useKnobEdit.ts";
import "./knobs.css";

const FLASH_MS = 1400;

/** "2 patches selected", "1 layer and 3 patches selected". */
function selectionText(layers: number, patches: number): string | null {
  const part = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (layers && patches) return `${part(layers, "layer", "layers")} and ${part(patches, "patch", "patches")} selected`;
  if (layers) return `${part(layers, "layer", "layers")} selected`;
  if (patches) return `${part(patches, "patch", "patches")} selected`;
  return null;
}

export function KnobsPanel() {
  const session = useEditorSession();
  const doc = useDocument((s) => s.doc);
  const set = doc.knobs;
  const layers = useSelection((s) => s.layers.length);
  const patches = useSelection((s) => s.patches.length);
  const remembered = useKnobsUi(session, (s) => s.partner);
  const onlyDifferences = useKnobsUi(session, (s) => s.onlyDifferences);
  const collapsed = useKnobsUi(session, (s) => s.collapsed);
  const flash = useKnobsUi(session, (s) => s.flash);
  const request = useKnobsUi(session, (s) => s.request);
  const edit = useKnobEdit();
  const partner = partnerPreset(set, remembered);
  // Readers and conversion candidates depend only on the components, so tuning doesn't recompute them.
  const components = doc.components;
  const uses = useMemo(() => knobUses(doc), [components]); // eslint-disable-line react-hooks/exhaustive-deps
  const candidates = useVariableCandidates();
  const groups = useMemo(() => (set ? knobGroups(set, uses, partner, onlyDifferences) : []), [set, uses, partner, onlyDifferences]);
  const [editing, setEditing] = useState<KnobEditTarget | null>(null);
  const [editAnchor, setEditAnchor] = useState<Element | null>(null);
  const [converting, setConverting] = useState(false);
  const [flashing, setFlashing] = useState<Id | null>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<Id, HTMLDivElement>());

  const openEditor = (target: KnobEditTarget, anchor: Element | null) => {
    setEditAnchor(anchor ?? menuRef.current ?? rootRef.current);
    setEditing(target);
  };

  // Commands (New Knob…, Convert Variables to Knobs…) ask the panel through the store.
  useEffect(() => {
    if (!request) return;
    knobsUi(session).getState().set({ request: null });
    if (request.kind === "convert") setConverting(true);
    else openEditor(request.kind === "newKnob" ? { kind: "new" } : { kind: "edit", id: request.id }, request.kind === "editKnob" ? (rows.current.get(request.id) ?? null) : null);
  }, [request, session]);

  // Show in Knobs: scroll to the row and flash it.
  useEffect(() => {
    if (!flash) return;
    const el = rows.current.get(flash.id);
    if (!el) return;
    el.scrollIntoView?.({ block: "nearest" });
    setFlashing(flash.id);
    const timer = setTimeout(() => setFlashing(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  const menu = (): MenuEntry[] => {
    const running = set?.presets.find((p) => p.id === set.active);
    return [
      { id: "newKnob", label: "New Knob…", icon: <Plus size={14} />, onSelect: () => openEditor({ kind: "new" }, menuRef.current) },
      { id: "newPreset", label: "New Preset", description: set ? `A copy of ${presetName(set, set.active)}` : undefined, onSelect: () => addPreset(edit, set) },
      ...(set && partner ? [{ id: "copy", label: "Copy Differences", description: `${presetName(set, set.active)} vs ${presetName(set, partner)}, as a table`, onSelect: () => copyDifferences(set, partner) } satisfies MenuEntry] : []),
      ...(candidates.knobs.length ? [{ id: "convert", label: "Convert Variables to Knobs…", icon: <WandSparkles size={14} />, onSelect: () => setConverting(true) } satisfies MenuEntry] : []),
      ...(set && running ? ([{ type: "separator" }, ...presetEntries(session, edit, set, running, true)] satisfies MenuEntry[]) : []),
    ];
  };

  const selection = selectionText(layers, patches);
  const running = set?.presets.find((p) => p.id === set.active);
  const locked = !!running?.locked;
  const unlocked = set?.presets.find((p) => p.id !== set.active && !p.locked);
  const knobCount = set?.knobs.length ?? 0;
  const differing = set && partner ? differenceCount(set, partner) : 0;

  /** ↑ and ↓ move between rows, to the same kind of control. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, [role='listbox'], [role='menu']")) return;
    const row = target.closest<HTMLElement>("[data-knob-row]");
    if (!row || !rootRef.current) return;
    const all = [...rootRef.current.querySelectorAll<HTMLElement>("[data-knob-row]")];
    const next = all[all.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    const control = next.querySelector<HTMLElement>(".sb-knob-row__control");
    (control ? getFocusable(control)[0] : undefined)?.focus();
  };

  return (
    <div ref={rootRef} className="sb-knobs" onKeyDown={onKeyDown}>
      {selection && (
        <div className="sb-knobs__selection">
          <span>{selection}</span>
          <span aria-hidden>·</span>
          <button type="button" className="sb-knobs__link" onClick={() => layoutStore.getState().setInspectorTab("properties")}>
            Show Properties
          </button>
        </div>
      )}
      {set && <PresetBar set={set} edit={edit} menu={menu} menuRef={menuRef} />}
      {locked && running && (
        <div className="sb-knobs-locked" role="status">
          <Lock size={12} strokeWidth={2} aria-hidden />
          <span className="sb-knobs-locked__text">{running.name} is locked, so its values stay as they are.</span>
          <span className="sb-knobs-locked__actions">
            {unlocked && (
              <Button size="sm" variant="ghost" onClick={() => edit.switchPreset(unlocked.id)}>
                Switch to {unlocked.name}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => edit.apply([{ op: "updateKnobPreset", id: running.id, locked: false }], `Unlock Preset “${running.name}”`)}>
              Unlock
            </Button>
          </span>
        </div>
      )}
      {set && partner && knobCount > 0 && (
        <div className="sb-knobs__filter">
          <Checkbox checked={onlyDifferences} label="Only differences" onChange={(on) => knobsUi(session).getState().set({ onlyDifferences: on })} />
          <span className="sb-knobs__filter-count" title={`Compared with ${presetName(set, partner)}`}>
            · {differing} of {knobCount} differ
          </span>
        </div>
      )}
      {knobCount === 0 ? (
        <EmptyState
          size="sm"
          className="sb-knobs__empty"
          icon={<SlidersHorizontal size={18} />}
          title="No knobs yet"
          description="Right-click a number in Properties and choose Make Knob, or ask Claude to build the idea as knobs."
          actions={
            <div className="sb-knobs__empty-actions">
              <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={(event) => openEditor({ kind: "new" }, event.currentTarget)}>
                New Knob…
              </Button>
              {candidates.knobs.length > 0 && (
                <p className="sb-knobs__note">
                  This prototype shares {candidates.knobs.length} {candidates.knobs.length === 1 ? "constant" : "constants"} through Variable Broadcasters.{" "}
                  <button type="button" className="sb-knobs__link" onClick={() => setConverting(true)}>
                    Convert to Knobs
                  </button>
                </p>
              )}
            </div>
          }
        />
      ) : (
        <div className="sb-knobs__groups">
          {groups.length === 0 && <p className="sb-knobs__note">Every knob has the same value in {set && partner ? presetName(set, partner) : "the other preset"}.</p>}
          {groups.map((group) => {
            const shut = group.name !== null && collapsed.has(group.name);
            return (
              <section key={group.name ?? ""} className="sb-knobs-group" aria-label={group.name ?? "Knobs"}>
                {group.name !== null && (
                  <button type="button" className="sb-knobs-group__title" aria-expanded={!shut} onClick={() => knobsUi(session).getState().toggleGroup(group.name!)}>
                    {shut ? <ChevronRight size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
                    {group.name}
                  </button>
                )}
                {!shut &&
                  group.rows.map((row) => (
                    <KnobRow
                      key={row.knob.id}
                      ref={(el) => {
                        if (el) rows.current.set(row.knob.id, el);
                        else rows.current.delete(row.knob.id);
                      }}
                      set={set!}
                      row={row}
                      readers={uses.get(row.knob.id) ?? []}
                      partner={partner}
                      locked={locked}
                      edit={edit}
                      flashing={flashing === row.knob.id}
                      onEdit={() => openEditor({ kind: "edit", id: row.knob.id }, rows.current.get(row.knob.id) ?? null)}
                    />
                  ))}
              </section>
            );
          })}
        </div>
      )}
      <KnobEditPopover target={editing} anchor={editAnchor} onClose={() => setEditing(null)} />
      <ConvertVariablesDialog open={converting} onClose={() => setConverting(false)} />
    </div>
  );
}

/** Copy Differences: the running preset against its partner, as a Markdown table for engineers. */
export function copyDifferences(set: KnobSet, partner: Id): void {
  const text = knobDifferencesMarkdown(set, set.active, partner);
  void globalThis.navigator?.clipboard?.writeText(text).then(
    () => toast({ id: "knob-differences", title: "Copied the differences", description: `${presetName(set, set.active)} vs ${presetName(set, partner)}, as a Markdown table.`, tone: "success" }),
    () => toast({ id: "knob-differences", title: "Couldn't copy to the clipboard", tone: "warn" }),
  );
}
