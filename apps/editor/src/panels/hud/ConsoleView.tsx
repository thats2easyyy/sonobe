import { ArrowDown, CircleX, Info, Search, Terminal, Trash2, TriangleAlert, type LucideIcon } from "lucide-react";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SonobeDocument } from "@sonobe/core";
import type { ConsoleEntry, ConsoleLevel } from "../../state/console.ts";
import { useConsole, useDocument, useEditorSession } from "../../state/EditorProvider.tsx";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { toast } from "../../ui/Toast.tsx";
import { ALL_CONSOLE_LEVELS, CONSOLE_LEVELS, consoleEntryTarget, filterConsoleEntries, formatConsoleTime, type ConsoleLevelFilter, type ConsoleSourceTarget } from "./consoleModel.ts";
import { FilterChip } from "./FilterChip.tsx";
import { focusSelectedTab } from "./focusTab.ts";
import { isFiltered, toggleFilter } from "./filters.ts";
import { LogMessage } from "./LogMessage.tsx";
import { revealItems } from "./reveal.ts";

const LEVELS: Record<ConsoleLevel, { label: string; Icon: LucideIcon; tone: "danger" | "warn" | "info" | "neutral" }> = {
  error: { label: "Errors", Icon: CircleX, tone: "danger" },
  warn: { label: "Warnings", Icon: TriangleAlert, tone: "warn" },
  info: { label: "Info", Icon: Info, tone: "info" },
  log: { label: "Logs", Icon: Terminal, tone: "neutral" },
};

const SOURCE_LABELS: Record<string, string> = { prototype: "Prototype", editor: "Editor", claude: "Claude" };

interface RowProps {
  entry: ConsoleEntry;
  target: ConsoleSourceTarget | null;
  expanded: boolean;
  onReveal: (target: ConsoleSourceTarget) => void;
  onToggleExpanded: (id: string) => void;
}

const ConsoleRow = memo(function ConsoleRow({ entry, target, expanded, onReveal, onToggleExpanded }: RowProps) {
  const { Icon, label } = LEVELS[entry.level];
  return (
    <div className="sb-logrow" data-level={entry.level} data-expanded={expanded || undefined} role="listitem">
      {entry.level === "log" ? (
        <span className="sb-logrow__icon" aria-hidden />
      ) : (
        <span className="sb-logrow__icon" role="img" aria-label={label.replace(/s$/, "")}>
          <Icon size={14} strokeWidth={2} />
        </span>
      )}
      <time className="sb-logrow__time sb-tabular" dateTime={new Date(entry.timestamp).toISOString()} title={formatConsoleTime(entry.timestamp)}>
        {formatConsoleTime(entry.timestamp).slice(0, 8)}
      </time>
      {target ? (
        <button type="button" className="sb-logrow__source" data-link onClick={() => onReveal(target)} title={`Reveal ${target.name} (${target.id})`} aria-label={`Reveal ${target.name}`}>
          {target.name}
        </button>
      ) : (
        <span className="sb-logrow__source">{SOURCE_LABELS[entry.source] ?? entry.source}</span>
      )}
      <LogMessage
        text={entry.message}
        expanded={expanded}
        onToggle={() => onToggleExpanded(entry.id)}
        trailing={
          entry.count > 1 && (
            <Badge size="sm" className="sb-tabular" aria-label={`Repeated ${entry.count} times`}>
              ×{entry.count}
            </Badge>
          )
        }
      />
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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const visible = useMemo(() => filterConsoleEntries(entries, { levels, query }), [entries, levels, query]);
  const targets = useMemo(() => targetsFor(doc, entries), [doc, entries]);
  const levelCounts = useMemo(() => {
    const counts: Record<ConsoleLevel, number> = { log: 0, info: 0, warn: 0, error: 0 };
    for (const e of entries) counts[e.level] += e.count;
    return counts;
  }, [entries]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const hasRows = visible.length > 0;
  const [behind, setBehind] = useState(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    else setBehind(true);
  }, [visible]);

  // A row that grows after it renders (its Show all button appears) shouldn't push the newest line out of view.
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const list = listRef.current;
    if (!scroll || !list) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) scroll.scrollTop = scroll.scrollHeight;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [hasRows]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    stickToBottom.current = atBottom;
    if (atBottom) setBehind(false);
  };

  // Opening a row moves the bottom away, closing it can bring it back; follow the tail only while it is in view.
  useLayoutEffect(() => {
    onScroll();
  }, [expanded]);

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = true;
    el.scrollTop = el.scrollHeight;
    setBehind(false);
  };

  const reveal = useCallback(
    (target: ConsoleSourceTarget) => {
      if (!revealItems(session, target.component, [target.id])) toast({ title: `“${target.name}” isn't in the document anymore`, tone: "neutral" });
    },
    [session],
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const filtered = isFiltered(levels) || query.trim() !== "";
  const nothingToFilter = entries.length === 0;

  return (
    <div className="sb-hudview">
      {!nothingToFilter && (
        <div className="sb-hudview__toolbar">
          <div className="sb-hudview__chips" role="group" aria-label="Show levels">
            {CONSOLE_LEVELS.map((level) => (
              <FilterChip
                key={level}
                pressed={levels[level]}
                tone={LEVELS[level].tone}
                icon={<LevelIcon level={level} />}
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
          <IconButton size="sm" icon={<Trash2 size={14} />} label="Clear console" tooltipPlacement="top" onClick={(event) => {
              focusSelectedTab(event.currentTarget);
              session.console.getState().clear();
            }}
          />
        </div>
      )}

      {nothingToFilter ? (
        <div className="sb-hudview__empty">
          <EmptyState size="sm" variant="inline" title="Nothing logged yet" description="console.log output and runtime warnings show up here." />
        </div>
      ) : visible.length === 0 ? (
        <div className="sb-hudview__empty">
          <EmptyState
            size="sm"
            variant="inline"
            title="No messages match"
            description={`${entries.length} ${entries.length === 1 ? "message is" : "messages are"} hidden by filters.`}
            actions={
              filtered && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(event) => {
                    focusSelectedTab(event.currentTarget);
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
          <div role="list" aria-label="Console output" aria-live="polite" aria-relevant="additions" ref={listRef}>
            {visible.map((entry) => (
              <ConsoleRow key={entry.id} entry={entry} target={targets.get(`${entry.componentPath ?? ""}|${entry.source}`) ?? null} expanded={expanded.has(entry.id)} onReveal={reveal} onToggleExpanded={toggleExpanded} />
            ))}
          </div>
        </div>
      )}

      {behind && hasRows && (
        <Button size="sm" variant="secondary" className="sb-hudview__jump" icon={<ArrowDown size={12} />} onClick={jumpToLatest}>
          New messages
        </Button>
      )}
    </div>
  );
}

function LevelIcon({ level }: { level: ConsoleLevel }) {
  const { Icon } = LEVELS[level];
  return <Icon size={12} strokeWidth={2} />;
}
