/**
 * The Inspector's Knobs tab: the project's knobs in one place, grouped, with the preset bar above
 * them (it stays in view while they scroll). Tuning a row edits the running preset live (no
 * restart), ticks and ≠ marks compare it with the partner preset, and a locked preset's rows are
 * read-only. The tab stays put as the selection changes; a line below the bar leads back to Properties.
 */

import { knobDifferencesMarkdown, type Id, type KnobSet } from "@sonobe/core";
import { ArrowLeftRight, ChevronRight, ClipboardCopy, CopyPlus, Lock, Plus, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { layoutStore } from "../../shell/layoutStore.ts";
import { useDocument, useEditorSession, useSelection } from "../../state/EditorProvider.tsx";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import type { MenuEntry } from "../../ui/Menu.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Checkbox } from "../../ui/Toggle.tsx";
import { getFocusable } from "../../ui/lib/focus.ts";
import { observeResize } from "../../ui/lib/observeResize.ts";
import { ConvertVariablesDialog, useVariableCandidates } from "./ConvertVariablesDialog.tsx";
import { KnobEditPopover, type KnobEditTarget } from "./KnobEditPopover.tsx";
import { KnobRow } from "./KnobRow.tsx";
import { knobsUi, useKnobsUi } from "./knobsStore.ts";
import { differenceCount, FLIP_PRESETS_SHORTCUT, knobGroups, knobUses, partnerPreset, presetColor, presetName } from "./model.ts";
import { addPreset, PresetBar, presetEntries } from "./PresetBar.tsx";
import { tuningKnob, useKnobEdit } from "./useKnobEdit.ts";
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
  // Only differences leaves in the row being dragged or scrubbed and the row with focus, so a value
  // tuned onto the partner's doesn't pull the row out from under the pointer or the keyboard.
  const tuning = useDocument((s) => tuningKnob(s.gesture));
  const [focusedRow, setFocusedRow] = useState<Id | null>(null);
  const keep = useMemo(() => new Set([tuning, focusedRow].filter((id): id is Id => id !== null)), [tuning, focusedRow]);
  const groups = useMemo(() => (set ? knobGroups(set, uses, partner, onlyDifferences, keep) : []), [set, uses, partner, onlyDifferences, keep]);
  const [editing, setEditing] = useState<KnobEditTarget | null>(null);
  const [editAnchor, setEditAnchor] = useState<Element | null>(null);
  const [converting, setConverting] = useState(false);
  const [flashing, setFlashing] = useState<Id | null>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
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

  // Show in Knobs: scroll to the row and flash it, first turning Only differences off when it hides
  // the knob and opening its group when it's collapsed. A request that can't be shown is dropped.
  useEffect(() => {
    if (!flash) return;
    const ui = knobsUi(session).getState();
    const el = rows.current.get(flash.id);
    if (!el) {
      const knob = session.document.getState().doc.knobs?.knobs.find((k) => k.id === flash.id);
      const listed = groups.some((g) => g.rows.some((r) => r.knob.id === flash.id));
      if (knob && !listed && ui.onlyDifferences) ui.set({ onlyDifferences: false });
      else if (knob?.group && ui.collapsed.has(knob.group)) ui.toggleGroup(knob.group);
      else ui.set({ flash: null });
      return;
    }
    el.scrollIntoView?.({ block: "nearest" });
    setFlashing(flash.id);
    ui.set({ flash: null });
  }, [flash, collapsed, groups, session]);

  // A row scrolled into view stops below the sticky header, whatever height it has (chips wrap).
  const hasHeader = !!set;
  useEffect(() => {
    const root = rootRef.current;
    const header = headerRef.current;
    if (!root || !header) return;
    const sync = () => root.style.setProperty("--sb-knobs-header", `${header.offsetHeight}px`);
    sync();
    return observeResize([header], sync);
  }, [hasHeader]);

  useEffect(() => {
    if (flashing === null) return;
    const timer = setTimeout(() => setFlashing(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashing]);

  const menu = (): MenuEntry[] => {
    const running = set?.presets.find((p) => p.id === set.active);
    return [
      { id: "newKnob", label: "New Knob…", icon: <Plus size={14} />, onSelect: () => openEditor({ kind: "new" }, menuRef.current) },
      { id: "newPreset", label: "New Preset", icon: <CopyPlus size={14} />, description: set ? `A copy of ${presetName(set, set.active)}` : undefined, onSelect: () => addPreset(session, edit, set) },
      ...(set && partner
        ? ([
            { id: "flip", label: "Flip Presets", icon: <ArrowLeftRight size={14} />, shortcut: FLIP_PRESETS_SHORTCUT, description: `Run ${presetName(set, partner)}`, onSelect: () => edit.switchPreset(partner) },
            { id: "copy", label: "Copy Differences", icon: <ClipboardCopy size={14} />, description: `${presetName(set, set.active)} vs ${presetName(set, partner)}, as a Markdown table`, onSelect: () => copyDifferences(set, partner) },
          ] satisfies MenuEntry[])
        : []),
      ...(candidates.knobs.length ? [{ id: "convert", label: "Convert Variables to Knobs…", icon: <SlidersHorizontal size={14} />, onSelect: () => setConverting(true) } satisfies MenuEntry] : []),
      ...(set && running ? ([{ type: "separator" }, ...presetEntries(session, edit, set, running, true)] satisfies MenuEntry[]) : []),
    ];
  };

  const selection = selectionText(layers, patches);
  const running = set?.presets.find((p) => p.id === set.active);
  const locked = !!running?.locked;
  const unlocked = set?.presets.find((p) => p.id !== set.active && !p.locked);
  const knobCount = set?.knobs.length ?? 0;
  const differing = set && partner ? differenceCount(set, partner) : 0;
  const unusedCount = set ? set.knobs.filter((k) => !uses.get(k.id)?.length).length : 0;

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
    <div
      ref={rootRef}
      className="sb-knobs"
      style={{ "--sb-partner-color": set && partner ? presetColor(set, partner) : undefined } as CSSProperties}
      onKeyDown={onKeyDown}
      onFocus={(event) => setFocusedRow((event.target as HTMLElement).closest<HTMLElement>("[data-knob-row]")?.dataset.knobRow ?? null)}
      onBlur={(event) => !event.currentTarget.contains(event.relatedTarget as Node | null) && setFocusedRow(null)}
    >
      {set && (
        <div ref={headerRef} className="sb-knobs__header">
          <PresetBar set={set} partner={partner} edit={edit} menu={menu} menuRef={menuRef} />
          {locked && running && (
            <div className="sb-knobs-locked" role="status">
              <Lock size={12} strokeWidth={1.75} aria-hidden />
              <span className="sb-knobs-locked__text">{running.name} is locked.</span>
              <span className="sb-knobs-locked__actions">
                {unlocked && (
                  <Button size="sm" onClick={() => edit.switchPreset(unlocked.id)}>
                    Switch to {unlocked.name}
                  </Button>
                )}
                <Button size="sm" onClick={() => edit.apply([{ op: "updateKnobPreset", id: running.id, locked: false }], `Unlock Preset “${running.name}”`)}>
                  Unlock
                </Button>
              </span>
            </div>
          )}
          {partner && knobCount > 0 && (
            <div className="sb-knobs__filter">
              <Checkbox checked={onlyDifferences} label="Only differences" onChange={(on) => knobsUi(session).getState().set({ onlyDifferences: on })} />
              <span className="sb-knobs__filter-count">
                {differing} of {knobCount} differ
              </span>
              <span className="sb-knobs__filter-vs">
                <span className="sb-knobs__filter-dot" aria-hidden />
                <span>vs {presetName(set, partner)}</span>
              </span>
            </div>
          )}
        </div>
      )}
      <div className="sb-knobs__selection">
        {selection && (
          <>
            <span>{selection}</span>
            <span aria-hidden>·</span>
            <button type="button" className="sb-knobs__link" onClick={() => layoutStore.getState().setInspectorTab("properties")}>
              Show Properties
            </button>
          </>
        )}
      </div>
      {unusedCount > 0 && (
        <p className="sb-knobs__note">
          {unusedCount} {unusedCount === 1 ? "knob isn't" : "knobs aren't"} used yet. Right-click a field in Properties and choose Use Knob.
        </p>
      )}
      {knobCount === 0 ? (
        <EmptyState
          className="sb-knobs__empty"
          variant="inline"
          title="No knobs yet"
          description={
            <>
              <p>Tune values live.</p>
              <p>
                Right-click a number in{" "}
                {selection ? (
                  "Properties"
                ) : (
                  <button type="button" className="sb-knobs__link" aria-label="Show Properties" onClick={() => layoutStore.getState().setInspectorTab("properties")}>
                    Properties
                  </button>
                )}
                , then choose Make Knob.
              </p>
            </>
          }
          actions={
            <div className="sb-knobs__empty-actions">
              <Button variant="ghost" icon={<Plus size={14} />} onClick={(event) => openEditor({ kind: "new" }, event.currentTarget)}>
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
            const differs = group.rows.filter((r) => r.differs).length;
            return (
              <section key={group.name ?? ""} className="sb-knobs-group" aria-label={group.name ?? "Knobs"}>
                {group.name !== null && (
                  <button type="button" className="sb-knobs-group__title" aria-expanded={!shut} onClick={() => knobsUi(session).getState().toggleGroup(group.name!)}>
                    <ChevronRight size={12} strokeWidth={1.75} className="sb-knobs-group__chevron" aria-hidden />
                    <span className="sb-knobs-group__name">{group.name}</span>
                    <span className="sb-knobs-group__count" aria-hidden>
                      {group.rows.length}
                    </span>
                    {shut && differs > 0 && <span className="sb-knobs-group__differ">{differs} differ</span>}
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
