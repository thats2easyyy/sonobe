import { ArrowDown, ChevronRight, CircleX, Info, Search, SquareTerminal, Trash2, TriangleAlert } from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SonobeDocument } from "@sonobe/core";
import type { ConsoleEntry, ConsoleLevel } from "../../state/console.ts";
import { useConsole, useDocument, useEditorSession } from "../../state/EditorProvider.tsx";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { toast } from "../../ui/Toast.tsx";
import { ALL_CONSOLE_LEVELS, CONSOLE_LEVELS, consoleEntryTarget, filterConsoleEntries, formatConsoleTime, scriptLocation, type ConsoleLevelFilter, type ConsoleSourceTarget } from "./consoleModel.ts";
import { FilterChip } from "./FilterChip.tsx";
import { isFiltered, toggleFilter } from "./filters.ts";
import { revealItems } from "./reveal.ts";

const LEVELS: Record<ConsoleLevel, { label: string; icon: ReactNode; tone: "danger" | "warn" | "info" | "neutral" }> = {
  error: { label: "Errors", icon: <CircleX size={12} strokeWidth={2} />, tone: "danger" },
  warn: { label: "Warnings", icon: <TriangleAlert size={12} strokeWidth={2} />, tone: "warn" },
  info: { label: "Info", icon: <Info size={12} strokeWidth={2} />, tone: "info" },
  log: { label: "Logs", icon: <ChevronRight size={12} strokeWidth={2} />, tone: "neutral" },
};

const SOURCE_LABELS: Record<string, string> = { prototype: "Prototype", editor: "Editor", claude: "Claude" };

interface RowProps {
  entry: ConsoleEntry;
  target: ConsoleSourceTarget | null;
  onReveal: (target: ConsoleSourceTarget) => void;
}

const ConsoleRow = memo(function ConsoleRow({ entry, target, onReveal }: RowProps) {
  const location = entry.level === "error" || entry.level === "warn" ? scriptLocation(entry.message) : null;
  return (
    <div className="sb-logrow" data-level={entry.level} role="listitem">
      <span className="sb-logrow__icon" aria-label={LEVELS[entry.level].label.replace(/s$/, "")}>
        {LEVELS[entry.level].icon}
      </span>
      <time className="sb-logrow__time sb-tabular" dateTime={new Date(entry.timestamp).toISOString()}>
        {formatConsoleTime(entry.timestamp)}
      </time>
      {target ? (
        <button type="button" className="sb-logrow__source" data-link onClick={() => onReveal(target)} title={`Reveal ${target.name} (${target.id})`} aria-label={`Reveal ${target.name}`}>
          {target.name}
        </button>
      ) : (
        <span className="sb-logrow__source">{SOURCE_LABELS[entry.source] ?? entry.source}</span>
      )}
      <span className="sb-logrow__message">{entry.message}</span>
      {(location || entry.count > 1) && (
        <span className="sb-logrow__badges">
          {location &&
            (target ? (
              <button type="button" className="sb-logrow__line" onClick={() => onReveal(target)} title={`Reveal ${target.name}`}>
                line {location.line}
                {location.column !== undefined ? `:${location.column}` : ""}
              </button>
            ) : (
              <span className="sb-logrow__line">
                line {location.line}
                {location.column !== undefined ? `:${location.column}` : ""}
              </span>
            ))}
          {entry.count > 1 && (
            <Badge size="sm" className="sb-tabular" aria-label={`Repeated ${entry.count} times`}>
              ×{entry.count}
            </Badge>
          )}
        </span>
      )}
    </div>
  );
});

function targetsFor(doc: SonobeDocument, entries: readonly ConsoleEntry[]): Map<string, ConsoleSourceTarget | null> {
  const out = new Map<string, ConsoleSourceTarget | null>();
  for (const entry of entries) {
    const key = `${entry.componentPath ?? ""}|${entry.source}`;
    if (!out.has(key)) out.set(key, consoleEntryTarget(doc, entry));
  }
  return out;
}

/** Console tab: prototype logs, runtime problems, and editor notices, with level and text filters. */
export function ConsoleView() {
  const session = useEditorSession();
  const entries = useConsole((s) => s.entries);
  const doc = useDocument((s) => s.doc);
  const [levels, setLevels] = useState<ConsoleLevelFilter>(ALL_CONSOLE_LEVELS);
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterConsoleEntries(entries, { levels, query }), [entries, levels, query]);
  const targets = useMemo(() => targetsFor(doc, entries), [doc, entries]);
  const levelCounts = useMemo(() => {
    const counts: Record<ConsoleLevel, number> = { log: 0, info: 0, warn: 0, error: 0 };
    for (const e of entries) counts[e.level] += e.count;
    return counts;
  }, [entries]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [behind, setBehind] = useState(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    else setBehind(true);
  }, [visible]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    stickToBottom.current = atBottom;
    if (atBottom) setBehind(false);
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = true;
    el.scrollTop = el.scrollHeight;
    setBehind(false);
  };

  const reveal = (target: ConsoleSourceTarget) => {
    if (!revealItems(session, target.component, [target.id])) toast({ title: `“${target.name}” isn't in the document anymore`, tone: "neutral" });
  };

  const filtered = isFiltered(levels) || query.trim() !== "";

  return (
    <div className="sb-hudview">
      <div className="sb-hudview__toolbar">
        <div className="sb-hudview__chips" role="group" aria-label="Show levels">
          {CONSOLE_LEVELS.map((level) => (
            <FilterChip
              key={level}
              pressed={levels[level]}
              tone={LEVELS[level].tone}
              icon={LEVELS[level].icon}
              label={LEVELS[level].label}
              count={levelCounts[level]}
              hint="Option-click to show only this level"
              onToggle={(event) => setLevels((current) => toggleFilter(current, level, event.altKey))}
            />
          ))}
        </div>
        <span className="sb-hudview__spacer" />
        <TextField
          size="sm"
          containerClassName="sb-hudview__search"
          aria-label="Filter console"
          placeholder="Filter"
          leading={<Search size={12} strokeWidth={2} />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onCancel={() => setQuery("")}
        />
        <IconButton size="sm" icon={<Trash2 size={13} />} label="Clear console" tooltipPlacement="top" disabled={entries.length === 0} onClick={() => session.console.getState().clear()} />
      </div>

      {entries.length === 0 ? (
        <div className="sb-hudview__empty">
          <EmptyState size="sm" icon={<SquareTerminal size={16} />} title="Console is clear" description="Logs from JavaScript patches, runtime warnings, and restarts show up here." />
        </div>
      ) : visible.length === 0 ? (
        <div className="sb-hudview__empty">
          <EmptyState
            size="sm"
            icon={<Search size={16} />}
            title="No messages match"
            description={`${entries.length} ${entries.length === 1 ? "message is" : "messages are"} hidden by filters.`}
            actions={
              filtered && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setLevels(ALL_CONSOLE_LEVELS);
                    setQuery("");
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="sb-hudview__scroll sb-scroll sb-selectable" ref={scrollRef} onScroll={onScroll}>
          <div role="list" aria-label="Console output" aria-live="polite" aria-relevant="additions">
            {visible.map((entry) => (
              <ConsoleRow key={entry.id} entry={entry} target={targets.get(`${entry.componentPath ?? ""}|${entry.source}`) ?? null} onReveal={reveal} />
            ))}
          </div>
        </div>
      )}

      {behind && visible.length > 0 && (
        <Button size="sm" variant="secondary" className="sb-hudview__jump" icon={<ArrowDown size={12} />} onClick={jumpToLatest}>
          New messages
        </Button>
      )}
    </div>
  );
}
