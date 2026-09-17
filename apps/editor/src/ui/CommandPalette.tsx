import { CornerDownLeft } from "lucide-react";
import { useCallback, useMemo, type KeyboardEvent } from "react";
import { Dialog } from "./Dialog.tsx";
import { Kbd } from "./Kbd.tsx";
import { SearchList } from "./SearchList.tsx";
import { useCommandList, useCommands } from "./commands/CommandProvider.tsx";
import type { Command } from "./commands/commandRegistry.ts";
import { matchesChord, parseShortcut } from "./commands/shortcutManager.ts";
import type { FuzzyKey } from "./lib/fuzzy.ts";
import "./CommandPalette.css";

interface PaletteItem {
  command: Command;
  group: string;
}

const KEYS: FuzzyKey<PaletteItem>[] = [
  { name: "title", get: (i) => i.command.title },
  { name: "keywords", get: (i) => i.command.keywords, weight: 0.7 },
  { name: "category", get: (i) => i.command.category, weight: 0.5 },
  { name: "id", get: (i) => i.command.id, weight: 0.35 },
];

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder?: string;
}

/** ⌘K: search every available command, see its shortcut, run it. Recent commands come first. */
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

  const items = useMemo<PaletteItem[]>(() => {
    const available = registry.available();
    const byId = new Map(available.map((c) => [c.id, c]));
    const recentIds = registry.recent().filter((id) => byId.has(id)).slice(0, 5);
    const recent = recentIds.map((id) => ({ command: byId.get(id)!, group: "Recent" }));
    const categoryOrder = new Map<string, number>();
    for (const c of available) {
      const category = c.category ?? "General";
      if (!categoryOrder.has(category)) categoryOrder.set(category, categoryOrder.size);
    }
    const rest = available
      .filter((c) => !recentIds.includes(c.id))
      .map((c) => ({ command: c, group: c.category ?? "General" }))
      .sort((a, b) => categoryOrder.get(a.group)! - categoryOrder.get(b.group)!);
    return [...recent, ...rest];
    // `all` changes whenever the registry does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, all]);

  const closeChord = useMemo(() => parseShortcut("Mod+K", platform), [platform]);

  const run = useCallback(
    (item: PaletteItem) => {
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
      keys={KEYS}
      getId={(i) => `${i.group}:${i.command.id}`}
      groupBy={(i) => i.group}
      onSelect={run}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (matchesChord(event, closeChord)) {
          event.preventDefault();
          onClose();
        }
      }}
      emptyState={(query) => (
        <div className="sb-palette__empty">
          <div className="sb-palette__empty-title">No commands match “{query}”</div>
          <div>Try a shorter word, like “view” or “patch”.</div>
        </div>
      )}
      renderItem={(item, ctx) => {
        const Icon = item.command.icon;
        return (
          <div className="sb-palette__item">
            <span className="sb-palette__icon" aria-hidden>
              {Icon ? <Icon size={15} strokeWidth={1.75} /> : null}
            </span>
            <span className="sb-palette__title">{ctx.highlight("title", item.command.title)}</span>
            {ctx.query && item.command.category && <span className="sb-palette__category">{item.command.category}</span>}
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
