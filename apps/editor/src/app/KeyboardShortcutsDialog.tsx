/**
 * Help ▸ Keyboard Shortcuts: a searchable cheat sheet. Every command with a shortcut by category, the
 * patch editor's single-key inserts, and the gestures no menu lists (knife cut, ⌥-drag, splice).
 */

import { getPatchSpec, type Registry } from "@sonobe/core";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { singleKeyInserts } from "../panels/patch-editor/model/singleKey.ts";
import { useEditorSession } from "../state/EditorProvider.tsx";
import { useCommandList, useCommands } from "../ui/commands/CommandProvider.tsx";
import { isCommandHidden, type Command } from "../ui/commands/commandRegistry.ts";
import { COMMAND_CATEGORY_ORDER } from "../ui/commands/paletteOrder.ts";
import type { Platform } from "../ui/commands/shortcutManager.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { Kbd } from "../ui/Kbd.tsx";
import { TextField } from "../ui/TextField.tsx";
import "./KeyboardShortcutsDialog.css";

export interface ShortcutEntry {
  title: string;
  /** Registry format ("Mod+Shift+K"), shown as keycaps. */
  shortcut?: string | readonly string[];
  /** A gesture described in words ("⌃ right-drag across cables"). */
  keys?: string;
}

export interface ShortcutSection {
  title: string;
  entries: ShortcutEntry[];
}

export const PATCH_KEYS_SECTION = "Patch Editor Keys";
export const GESTURES_SECTION = "Gestures";

/** Pointer gestures, in the platform's modifier names. */
export function gestureEntries(platform: Platform): ShortcutEntry[] {
  const mac = platform === "mac";
  return [
    { title: "Search patches to insert", keys: mac ? "Double-click the graph, or ⌥⏎" : "Double-click the graph, or Alt+Enter" },
    { title: "Connect ports", keys: "Drag from an output to an input" },
    { title: "Fan one output out to several inputs", keys: mac ? "Click an output, then ⇧-click inputs" : "Click an output, then Shift-click inputs" },
    { title: "Cut cables", keys: mac ? "⌃ + right-drag across them" : "Ctrl + right-drag across them" },
    { title: "Duplicate patches or layers", keys: mac ? "⌥-drag them" : "Alt-drag them" },
    { title: "Splice a patch into a cable", keys: mac ? "⌘-drag it onto the cable" : "Ctrl-drag it onto the cable" },
    { title: "Publish a port on a component", keys: mac ? "Point at the port, press ⌥P" : "Point at the port, press Alt+P" },
    { title: "Pan", keys: "Space-drag, or drag with the middle button" },
    { title: "Zoom", keys: mac ? "⌘-scroll, or pinch" : "Ctrl-scroll, or pinch" },
  ];
}

/** The cheat sheet's sections: commands by category (menu order), single-key inserts, then gestures. */
export function shortcutSections(commands: readonly Command[], registry: Registry, platform: Platform): ShortcutSection[] {
  const byCategory = new Map<string, ShortcutEntry[]>();
  for (const command of commands) {
    // The palette hides itself from its own list, but it belongs on the cheat sheet.
    if (!command.shortcut || (isCommandHidden(command) && command.id !== "app.commandPalette")) continue;
    const category = command.category ?? "General";
    byCategory.set(category, [...(byCategory.get(category) ?? []), { title: command.id === "app.commandPalette" ? "Command Palette" : command.title, shortcut: command.shortcut }]);
  }
  const rank = (category: string) => {
    const index = COMMAND_CATEGORY_ORDER.indexOf(category);
    return index === -1 ? COMMAND_CATEGORY_ORDER.length : index;
  };
  const sections: ShortcutSection[] = [...byCategory]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([title, entries]) => ({ title, entries }));
  const inserts = singleKeyInserts(registry).map((insert): ShortcutEntry => ({ title: `Insert ${getPatchSpec(registry, insert.type)?.name ?? insert.type}`, shortcut: insert.shortcut }));
  if (inserts.length) sections.push({ title: PATCH_KEYS_SECTION, entries: inserts });
  sections.push({ title: GESTURES_SECTION, entries: gestureEntries(platform) });
  return sections;
}

/** Sections with only the entries that match `query` (a matching section title keeps them all). */
export function filterShortcutSections(sections: readonly ShortcutSection[], query: string): ShortcutSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...sections];
  return sections
    .map((section) => ({ ...section, entries: section.title.toLowerCase().includes(q) ? section.entries : section.entries.filter((e) => e.title.toLowerCase().includes(q) || (e.keys ?? "").toLowerCase().includes(q)) }))
    .filter((section) => section.entries.length > 0);
}

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label="Keyboard shortcuts" width={760} modalScope="shortcuts" className="sb-shortcuts">
      <ShortcutsBody onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

function ShortcutsBody({ onClose }: { onClose: () => void }) {
  const session = useEditorSession();
  const { platform } = useCommands();
  const commands = useCommandList();
  const [query, setQuery] = useState("");
  const sections = useMemo(() => shortcutSections(commands, session.registry, platform), [commands, session.registry, platform]);
  const shown = filterShortcutSections(sections, query);
  return (
    <div className="sb-shortcuts__body">
      <header className="sb-shortcuts__header">
        <h2 className="sb-shortcuts__title">Keyboard Shortcuts</h2>
        <TextField
          size="sm"
          autoFocus
          aria-label="Search shortcuts"
          placeholder="Search shortcuts"
          leading={<Search size={12} strokeWidth={2} />}
          containerClassName="sb-shortcuts__search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onCancel={() => (query ? setQuery("") : onClose())}
        />
      </header>
      <div className="sb-shortcuts__sections sb-scroll">
        {shown.length === 0 && <p className="sb-shortcuts__empty">No shortcuts match “{query.trim()}”.</p>}
        {shown.map((section) => (
          <section key={section.title} className="sb-shortcuts__section" aria-label={section.title}>
            <h3 className="sb-shortcuts__section-title">{section.title}</h3>
            <dl className="sb-shortcuts__list">
              {section.entries.map((entry, i) => (
                <div key={`${entry.title}:${i}`} className="sb-shortcuts__row">
                  <dt className="sb-shortcuts__action">{entry.title}</dt>
                  <dd className="sb-shortcuts__keys">{entry.shortcut ? <Kbd shortcut={entry.shortcut} /> : <span className="sb-shortcuts__gesture">{entry.keys}</span>}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
