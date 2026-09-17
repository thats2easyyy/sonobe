import { Check, ChevronDown, Search } from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Popover } from "./Popover.tsx";
import { HighlightedText } from "./SearchList.tsx";
import { cx } from "./lib/cx.ts";
import { fuzzySearch, type FuzzyKey } from "./lib/fuzzy.ts";
import type { Placement } from "./lib/position.ts";
import "./Select.css";

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  description?: string;
  icon?: ReactNode;
  group?: string;
  disabled?: boolean;
  keywords?: readonly string[];
  trailing?: ReactNode;
}

export interface SelectProps<V extends string = string> {
  options: readonly SelectOption<V>[];
  value: V | null;
  onChange: (value: V) => void;
  "aria-label": string;
  placeholder?: string;
  /** Show a search field. Defaults to true when there are more than 8 options. */
  searchable?: boolean;
  searchPlaceholder?: string;
  size?: "sm" | "md";
  /** "field" looks like an input; "ghost" blends into toolbars. */
  variant?: "field" | "ghost";
  disabled?: boolean;
  mixed?: boolean;
  renderValue?: (option: SelectOption<V> | undefined) => ReactNode;
  placement?: Placement;
  menuWidth?: number;
  emptyText?: string;
  className?: string;
}

const KEYS: FuzzyKey<SelectOption>[] = [
  { name: "label", get: (o) => o.label },
  { name: "keywords", get: (o) => o.keywords, weight: 0.7 },
  { name: "description", get: (o) => o.description, weight: 0.3 },
];

/** Dropdown select with optional fuzzy search, groups, and full keyboard support. */
export function Select<V extends string = string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  placeholder = "Select…",
  searchable,
  searchPlaceholder = "Search…",
  size = "md",
  variant = "field",
  disabled = false,
  mixed = false,
  renderValue,
  placement = "bottom-start",
  menuWidth,
  emptyText = "No matches",
  className,
}: SelectProps<V>) {
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const selected = options.find((o) => o.value === value);
  const isSearchable = searchable ?? options.length > 8;

  const content = mixed ? "Mixed" : renderValue ? renderValue(selected) : (selected?.label ?? placeholder);

  return (
    <>
      <button
        ref={setTrigger}
        type="button"
        className={cx("sb-select", className)}
        data-size={size}
        data-variant={variant}
        data-open={open || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${ariaLabel}: ${mixed ? "Mixed" : (selected?.label ?? "none")}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {selected?.icon && !mixed && <span className="sb-select__icon">{selected.icon}</span>}
        <span className="sb-select__value" data-placeholder={(!selected && !mixed) || undefined} data-mixed={mixed || undefined}>
          {content}
        </span>
        <ChevronDown size={12} strokeWidth={2} className="sb-select__chevron" aria-hidden />
      </button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchor={trigger}
        placement={placement}
        matchAnchorWidth
        initialFocus="none"
        role="presentation"
        className="sb-select-popover"
        style={menuWidth ? { width: menuWidth } : undefined}
      >
        <SelectMenu
          options={options}
          value={value}
          searchable={isSearchable}
          searchPlaceholder={searchPlaceholder}
          emptyText={emptyText}
          ariaLabel={ariaLabel}
          onPick={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      </Popover>
    </>
  );
}

interface SelectMenuProps<V extends string> {
  options: readonly SelectOption<V>[];
  value: V | null;
  searchable: boolean;
  searchPlaceholder: string;
  emptyText: string;
  ariaLabel: string;
  onPick: (value: V) => void;
}

function SelectMenu<V extends string>({ options, value, searchable, searchPlaceholder, emptyText, ariaLabel, onPick }: SelectMenuProps<V>) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: "", at: 0 });

  const results = useMemo(() => {
    if (!query.trim()) return options.map((option) => ({ option, indices: undefined as number[] | undefined }));
    return fuzzySearch(options as readonly SelectOption[], query, KEYS).map((r) => ({
      option: r.item as SelectOption<V>,
      indices: r.matches.label?.indices,
    }));
  }, [options, query]);

  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const activeId = results[active] ? `${listId}-${active}` : undefined;

  useLayoutEffect(() => {
    (searchable ? inputRef.current : listRef.current)?.focus({ preventScroll: true });
  }, [searchable]);

  useLayoutEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const move = (from: number, direction: 1 | -1) => {
    for (let step = 1; step <= results.length; step++) {
      const index = (from + direction * step + results.length) % results.length;
      if (!results[index]?.option.disabled) {
        setActive(index);
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") move(active, 1);
    else if (event.key === "ArrowUp") move(active, -1);
    else if (event.key === "Home" && !searchable) move(-1, 1);
    else if (event.key === "End" && !searchable) move(results.length, -1);
    else if (event.key === "Enter" || (event.key === " " && !searchable)) {
      const option = results[active]?.option;
      if (option && !option.disabled) onPick(option.value);
    } else if (!searchable && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      typeahead.current.text = now - typeahead.current.at > 600 ? event.key.toLowerCase() : typeahead.current.text + event.key.toLowerCase();
      typeahead.current.at = now;
      const found = results.findIndex((r) => !r.option.disabled && r.option.label.toLowerCase().startsWith(typeahead.current.text));
      if (found >= 0) setActive(found);
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  let lastGroup: string | undefined;
  const showGroups = !query.trim();

  return (
    <div className="sb-selectmenu" onKeyDown={onKeyDown}>
      {searchable && (
        <div className="sb-selectmenu__search">
          <Search size={13} aria-hidden />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label={`Search ${ariaLabel}`}
            placeholder={searchPlaceholder}
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
          />
        </div>
      )}
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={ariaLabel}
        tabIndex={searchable ? -1 : 0}
        aria-activedescendant={searchable ? undefined : activeId}
        className="sb-selectmenu__list sb-scroll"
      >
        {results.map(({ option, indices }, index) => {
          const header = showGroups && option.group && option.group !== lastGroup ? option.group : null;
          lastGroup = option.group;
          const isSelected = option.value === value;
          return (
            <div key={option.value} role="presentation">
              {header && (
                <div className="sb-selectmenu__group" role="presentation">
                  {header}
                </div>
              )}
              <div
                id={`${listId}-${index}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                className="sb-selectmenu__option"
                data-active={index === active || undefined}
                data-disabled={option.disabled || undefined}
                onPointerMove={() => {
                  if (index !== active && !option.disabled) setActive(index);
                }}
                onClick={() => {
                  if (!option.disabled) onPick(option.value);
                }}
              >
                <span className="sb-selectmenu__check" aria-hidden>
                  {isSelected && <Check size={12} strokeWidth={2.25} />}
                </span>
                {option.icon && <span className="sb-selectmenu__icon">{option.icon}</span>}
                <span className="sb-selectmenu__text">
                  <span className="sb-selectmenu__label">
                    <HighlightedText text={option.label} indices={indices} />
                  </span>
                  {option.description && <span className="sb-selectmenu__description">{option.description}</span>}
                </span>
                {option.trailing && <span className="sb-selectmenu__trailing">{option.trailing}</span>}
              </div>
            </div>
          );
        })}
        {results.length === 0 && <div className="sb-selectmenu__empty">{emptyText}</div>}
      </div>
    </div>
  );
}
