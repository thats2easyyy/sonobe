import { CornerDownLeft } from "lucide-react";
import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { Dialog } from "./Dialog.tsx";
import { Kbd } from "./Kbd.tsx";
import { SearchList } from "./SearchList.tsx";
import { useCommandList, useCommands } from "./commands/CommandProvider.tsx";
import { commandDisabledReason, commandTitle } from "./commands/commandRegistry.ts";
import { orderPaletteItems, type PaletteItem } from "./commands/paletteOrder.ts";
import { matchesChord, parseShortcut } from "./commands/shortcutManager.ts";
import type { FuzzyKey } from "./lib/fuzzy.ts";
import "./CommandPalette.css";

/** A palette row: the command, whether it can run now (and why not), and its title right now ("Undo Mute Card Shadow"). */
export interface PaletteRow extends PaletteItem {
  enabled: boolean;
  title: string;
  reason?: string;
}

/**
 * Titles, keywords, and categories match at word starts only, so scattered letters ("copy" in
 * "Close Prototype") don't surface unrelated commands. Ids aren't searched.
 */
export const PALETTE_KEYS: FuzzyKey<PaletteRow>[] = [
  { name: "title", get: (i) => i.title, wordStart: true },
  { name: "keywords", get: (i) => (i.title === i.command.title ? i.command.keywords : [i.command.title, ...(i.command.keywords ?? [])]), weight: 0.7, wordStart: true },
  { name: "category", get: (i) => i.command.category, weight: 0.5, wordStart: true },
];

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder?: string;
}

/**
 * ⌘K: search every command, see its shortcut, run it. Browsing lists what you can run now (recent
 * commands first); searching also shows the rest greyed out with what they need ("Select 2 or more
 * patches").
 */
export function CommandPalette({ open, onOpenChange, placeholder = "Type a command or search…" }: CommandPaletteProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label="Command palette" placement="top" width={620} modalScope="palette" className="sb-palette">
      <PaletteBody placeholder={placeholder} onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

function PaletteBody({ placeholder, onClose }: { placeholder: string; onClose: () => void }) {
  const { registry, platform } = useCommands();
  const all = useCommandList();
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  const items = useMemo<PaletteRow[]>(
    () => {
      const listed = registry.listed();
      const enabled = new Set(listed.filter((c) => registry.isEnabled(c.id)).map((c) => c.id));
      const shown = searching ? listed : listed.filter((c) => enabled.has(c.id));
      return orderPaletteItems(shown, registry.recent()).map((item): PaletteRow => {
        const on = enabled.has(item.command.id);
        return { ...item, enabled: on, title: commandTitle(item.command), ...(on ? {} : { reason: commandDisabledReason(item.command) }) };
      });
    },
    // `all` changes whenever the registry does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, all, searching],
  );

  const closeChord = useMemo(() => parseShortcut("Mod+K", platform), [platform]);

  const run = useCallback(
    (item: PaletteRow) => {
      if (!item.enabled) return;
      onClose();
      // Run after the dialog unmounts and focus returns to where it was.
      requestAnimationFrame(() => registry.run(item.command.id));
    },
    [onClose, registry],
  );

  return (
    <SearchList
      size="lg"
      aria-label="Commands"
      placeholder={placeholder}
      items={items}
      keys={PALETTE_KEYS}
      query={query}
      onQueryChange={setQuery}
      getId={(i) => `${i.group}:${i.command.id}`}
      groupBy={(i) => i.group}
      isDisabled={(i) => !i.enabled}
      onSelect={run}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (matchesChord(event, closeChord)) {
          event.preventDefault();
          onClose();
        }
      }}
      emptyState={(q) => (
        <div className="sb-palette__empty">
          <div className="sb-palette__empty-title">No commands match “{q}”</div>
          <div>Looking for a patch? Close this, point at the patch editor, and press ⌥⏎ to search patches.</div>
        </div>
      )}
      renderItem={(item, ctx) => {
        const Icon = item.command.icon;
        return (
          <div className="sb-palette__item" data-disabled={!item.enabled || undefined}>
            <span className="sb-palette__icon" aria-hidden>
              {Icon ? <Icon size={15} strokeWidth={1.75} /> : null}
            </span>
            <span className="sb-palette__title">{ctx.highlight("title", item.title)}</span>
            {ctx.query && item.command.category && <span className="sb-palette__category">{item.command.category}</span>}
            {!item.enabled && item.reason && <span className="sb-palette__reason">{item.reason}</span>}
            {item.command.shortcut && <Kbd shortcut={item.command.shortcut} className="sb-palette__kbd" />}
          </div>
        );
      }}
      footer={
        <>
          <span className="sb-palette__hint">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to navigate
          </span>
          <span className="sb-palette__hint">
            <Kbd>
              <CornerDownLeft size={10} strokeWidth={2.25} />
            </Kbd>
            to run
          </span>
          <span className="sb-palette__hint">
            <Kbd>Esc</Kbd> to close
          </span>
        </>
      }
    />
  );
}
