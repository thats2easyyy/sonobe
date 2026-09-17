import { Search } from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { cx } from "./lib/cx.ts";
import { fuzzySearch, highlightSegments, type FieldMatch, type FuzzyKey } from "./lib/fuzzy.ts";
import { useControllableState, useLatest } from "./lib/hooks.ts";
import "./SearchList.css";

/** Renders text with matched characters wrapped in <mark>. */
export function HighlightedText({ text, indices }: { text: string; indices?: readonly number[] }) {
  if (!indices?.length) return <>{text}</>;
  return (
    <>
      {highlightSegments(text, indices).map((segment, i) =>
        segment.match ? (
          <mark key={i} className="sb-highlight">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}

export interface SearchListRenderContext {
  active: boolean;
  query: string;
  matches: Record<string, FieldMatch>;
  /** Highlight `text` when it is the value that matched `key`. */
  highlight: (key: string, text: string) => ReactNode;
}

export interface SearchListProps<T> {
  items: readonly T[];
  keys: readonly FuzzyKey<T>[];
  getId: (item: T) => string;
  renderItem: (item: T, ctx: SearchListRenderContext) => ReactNode;
  /** Right-hand pane for the active item (docs, examples). */
  renderPreview?: (item: T | null) => ReactNode;
  onSelect: (item: T) => void;
  onActiveChange?: (item: T | null) => void;
  /** Section headers when the query is empty (items should already be ordered by group). */
  groupBy?: (item: T) => string | undefined;
  /** Rows shown greyed out that can't be picked; while searching they sort after the rest. */
  isDisabled?: (item: T) => boolean;
  renderGroupLabel?: (group: string) => ReactNode;
  query?: string;
  defaultQuery?: string;
  onQueryChange?: (query: string) => void;
  placeholder?: string;
  "aria-label": string;
  emptyState?: ReactNode | ((query: string) => ReactNode);
  limit?: number;
  autoFocus?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  footer?: ReactNode;
  /** Intercept keys before navigation (e.g. ⌘K to close). */
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>, active: T | null) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  size?: "md" | "lg";
  className?: string;
}

interface Row<T> {
  item: T;
  index: number;
  matches: Record<string, FieldMatch>;
  group?: string;
}

/**
 * Search field + ranked results + optional preview pane, driven entirely from the keyboard:
 * ↑/↓ (PageUp/PageDown for bigger jumps) move, Enter picks. Used by the patch picker and palette.
 */
export function SearchList<T>({
  items,
  keys,
  getId,
  renderItem,
  renderPreview,
  onSelect,
  onActiveChange,
  groupBy,
  isDisabled,
  renderGroupLabel,
  query: controlledQuery,
  defaultQuery = "",
  onQueryChange,
  placeholder = "Search…",
  "aria-label": ariaLabel,
  emptyState,
  limit,
  autoFocus = true,
  leading,
  trailing,
  footer,
  onKeyDown,
  inputRef: externalInputRef,
  size = "md",
  className,
}: SearchListProps<T>) {
  const listId = useId();
  const [query, setQuery] = useControllableState(controlledQuery, defaultQuery, onQueryChange);
  const [active, setActive] = useState(0);
  const localInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? localInputRef;
  const listRef = useRef<HTMLDivElement>(null);
  const scrollOnChange = useRef(false);
  const lastPointer = useRef({ x: -1, y: -1 });
  const onActiveChangeRef = useLatest(onActiveChange);

  const rows = useMemo<Row<T>[]>(() => {
    let results = fuzzySearch(items, query, keys, { limit });
    if (isDisabled && query.trim()) results = [...results.filter((r) => !isDisabled(r.item)), ...results.filter((r) => isDisabled(r.item))];
    return results.map((r, index) => ({
      item: r.item,
      index,
      matches: r.matches,
      group: !query.trim() && groupBy ? groupBy(r.item) : undefined,
    }));
  }, [items, query, keys, limit, groupBy, isDisabled]);

  const clampedActive = rows.length === 0 ? -1 : Math.min(active, rows.length - 1);
  const activeRow = clampedActive >= 0 ? rows[clampedActive] : undefined;
  const activeItem = activeRow?.item ?? null;
  const activeDomId = activeRow ? `${listId}-${clampedActive}` : undefined;

  useLayoutEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus, inputRef]);

  useLayoutEffect(() => {
    onActiveChangeRef.current?.(activeItem);
  }, [activeItem, onActiveChangeRef]);

  useLayoutEffect(() => {
    if (!scrollOnChange.current || !activeDomId) return;
    scrollOnChange.current = false;
    document.getElementById(activeDomId)?.scrollIntoView({ block: "nearest" });
  }, [activeDomId]);

  const go = (index: number) => {
    if (rows.length === 0) return;
    scrollOnChange.current = true;
    setActive(Math.max(0, Math.min(rows.length - 1, index)));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event, activeItem);
    if (event.defaultPrevented) return;
    const mod = event.metaKey || event.ctrlKey;
    switch (event.key) {
      case "ArrowDown":
        if (mod) go(rows.length - 1);
        else go(clampedActive + 1 >= rows.length ? 0 : clampedActive + 1);
        break;
      case "ArrowUp":
        if (mod) go(0);
        else go(clampedActive - 1 < 0 ? rows.length - 1 : clampedActive - 1);
        break;
      case "PageDown":
        go(clampedActive + 8);
        break;
      case "PageUp":
        go(clampedActive - 8);
        break;
      case "Enter":
        if (activeItem !== null && !isDisabled?.(activeItem)) onSelect(activeItem);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  let lastGroup: string | undefined;

  return (
    <div className={cx("sb-searchlist", className)} data-size={size} data-with-preview={renderPreview ? "" : undefined}>
      <div className="sb-searchlist__header">
        <span className="sb-searchlist__leading" aria-hidden>
          {leading ?? <Search size={size === "lg" ? 16 : 14} strokeWidth={1.75} />}
        </span>
        <input
          ref={inputRef}
          className="sb-searchlist__input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeDomId}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            if (listRef.current) listRef.current.scrollTop = 0;
          }}
          onKeyDown={handleKeyDown}
        />
        {trailing}
      </div>
      <div className="sb-searchlist__body">
        <div ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} className="sb-searchlist__list sb-scroll">
          {rows.map((row) => {
            const header = row.group && row.group !== lastGroup ? row.group : null;
            lastGroup = row.group;
            const isActive = row.index === clampedActive;
            return (
              <div key={getId(row.item)} role="presentation">
                {header && (
                  <div className="sb-searchlist__group" role="presentation">
                    {renderGroupLabel ? renderGroupLabel(header) : header}
                  </div>
                )}
                <div
                  id={`${listId}-${row.index}`}
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={isDisabled?.(row.item) || undefined}
                  className="sb-searchlist__option"
                  data-active={isActive || undefined}
                  data-disabled={isDisabled?.(row.item) || undefined}
                  onPointerMove={(event) => {
                    if (event.clientX === lastPointer.current.x && event.clientY === lastPointer.current.y) return;
                    lastPointer.current = { x: event.clientX, y: event.clientY };
                    if (!isActive) setActive(row.index);
                  }}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (!isDisabled?.(row.item)) onSelect(row.item);
                  }}
                >
                  {renderItem(row.item, {
                    active: isActive,
                    query,
                    matches: row.matches,
                    highlight: (key, text) => {
                      const match = row.matches[key];
                      return <HighlightedText text={text} indices={match?.value === text ? match.indices : undefined} />;
                    },
                  })}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="sb-searchlist__empty">
              {typeof emptyState === "function" ? emptyState(query) : (emptyState ?? `Nothing matches “${query}”`)}
            </div>
          )}
        </div>
        {renderPreview && <div className="sb-searchlist__preview sb-scroll">{renderPreview(activeItem)}</div>}
      </div>
      {footer && <div className="sb-searchlist__footer">{footer}</div>}
    </div>
  );
}
