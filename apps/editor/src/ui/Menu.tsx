import { Check, ChevronRight } from "lucide-react";
import {
  Children,
  cloneElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type KeyboardEventHandler,
  type MouseEvent,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { Kbd } from "./Kbd.tsx";
import { Popover } from "./Popover.tsx";
import { cx } from "./lib/cx.ts";
import { useMergedRefs } from "./lib/hooks.ts";
import type { Placement, Rect } from "./lib/position.ts";
import "./Menu.css";

export interface MenuItemEntry {
  type?: "item";
  id: string;
  label: string;
  icon?: ReactNode;
  /** Registry format, e.g. "Mod+D". Display only; bind it through the command registry. */
  shortcut?: string;
  description?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Renders a checkmark item (menuitemcheckbox). */
  checked?: boolean;
  submenu?: readonly MenuEntry[];
  /** Keep the menu open after selecting (toggles). */
  keepOpen?: boolean;
  onSelect?: () => void;
}

export type MenuEntry = MenuItemEntry | { type: "separator"; id?: string } | { type: "label"; id?: string; label: string };

const isItem = (entry: MenuEntry | undefined): entry is MenuItemEntry => !!entry && (entry.type === undefined || entry.type === "item");

export type MenuCloseReason = "select" | "escape" | "back" | "tab";

export interface MenuListProps {
  entries: readonly MenuEntry[];
  onClose: (reason: MenuCloseReason) => void;
  "aria-label"?: string;
  /** Focus the first item on mount (keyboard open) or just the menu container. */
  autoFocus?: "first" | "container" | "none";
  /** Nested level; ArrowLeft closes it. */
  submenu?: boolean;
  className?: string;
}

const HOVER_INTENT_MS = 120;

/** The keyboard-navigable list behind Menu, ContextMenu, and submenus. */
export function MenuList({ entries, onClose, "aria-label": ariaLabel, autoFocus = "first", submenu = false, className }: MenuListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(-1);
  const [openSub, setOpenSub] = useState<{ index: number; viaKeyboard: boolean } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const typeahead = useRef({ text: "", at: 0 });

  const enabled = useMemo(() => entries.flatMap((entry, i) => (isItem(entry) && !entry.disabled ? [i] : [])), [entries]);

  const focusIndex = useCallback((index: number) => {
    setActive(index);
    itemRefs.current[index]?.focus({ preventScroll: false });
  }, []);

  useLayoutEffect(() => {
    if (autoFocus === "first" && enabled.length > 0) focusIndex(enabled[0]!);
    else if (autoFocus === "container") containerRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const move = (direction: 1 | -1) => {
    if (enabled.length === 0) return;
    const position = enabled.indexOf(active);
    const next =
      position === -1 ? (direction === 1 ? enabled[0]! : enabled[enabled.length - 1]!) : enabled[(position + direction + enabled.length) % enabled.length]!;
    focusIndex(next);
  };

  const activate = (index: number, viaKeyboard: boolean) => {
    const entry = entries[index];
    if (!isItem(entry) || entry.disabled) return;
    if (entry.submenu) {
      setOpenSub({ index, viaKeyboard });
      return;
    }
    entry.onSelect?.();
    if (!entry.keepOpen) onClose("select");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const entry = entries[active];
    switch (event.key) {
      case "ArrowDown":
        move(1);
        break;
      case "ArrowUp":
        move(-1);
        break;
      case "Home":
        if (enabled.length) focusIndex(enabled[0]!);
        break;
      case "End":
        if (enabled.length) focusIndex(enabled[enabled.length - 1]!);
        break;
      case "ArrowRight":
        if (isItem(entry) && entry.submenu) setOpenSub({ index: active, viaKeyboard: true });
        else return;
        break;
      case "ArrowLeft":
        if (submenu) onClose("back");
        else return;
        break;
      case "Enter":
      case " ":
        if (active >= 0) activate(active, true);
        break;
      case "Tab":
        onClose("tab");
        break;
      default: {
        if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
        const now = Date.now();
        const text = now - typeahead.current.at > 600 ? event.key.toLowerCase() : typeahead.current.text + event.key.toLowerCase();
        typeahead.current = { text, at: now };
        const match = enabled.find((i) => (entries[i] as MenuItemEntry).label.toLowerCase().startsWith(text));
        if (match !== undefined) focusIndex(match);
      }
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const onHover = (index: number, hasSubmenu: boolean) => {
    if (active !== index) focusIndex(index);
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      setOpenSub((current) => (hasSubmenu ? (current?.index === index ? current : { index, viaKeyboard: false }) : null));
    }, HOVER_INTENT_MS);
  };

  return (
    <div ref={containerRef} role="menu" aria-label={ariaLabel} tabIndex={-1} className={cx("sb-menu sb-scroll", className)} onKeyDown={onKeyDown}>
      {entries.map((entry, index) => {
        if (entry.type === "separator") return <div key={entry.id ?? `sep-${index}`} role="separator" className="sb-menu__separator" />;
        if (entry.type === "label")
          return (
            <div key={entry.id ?? `label-${index}`} role="presentation" className="sb-menu__label">
              {entry.label}
            </div>
          );
        const item = entry as MenuItemEntry;
        const hasSubmenu = !!item.submenu;
        const subOpen = openSub?.index === index;
        return (
          <div
            key={item.id}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            role={item.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
            aria-checked={item.checked}
            aria-disabled={item.disabled || undefined}
            aria-haspopup={hasSubmenu ? "menu" : undefined}
            aria-expanded={hasSubmenu ? subOpen : undefined}
            tabIndex={-1}
            className="sb-menu__item"
            data-active={active === index || subOpen || undefined}
            data-danger={item.danger || undefined}
            data-disabled={item.disabled || undefined}
            onPointerMove={() => {
              if (!item.disabled && (active !== index || !hoverTimer.current)) onHover(index, hasSubmenu);
            }}
            onClick={() => activate(index, false)}
          >
            <span className="sb-menu__icon" aria-hidden>
              {item.checked ? <Check size={13} strokeWidth={2.25} /> : item.icon}
            </span>
            <span className="sb-menu__text">
              <span className="sb-menu__title">{item.label}</span>
              {item.description && <span className="sb-menu__description">{item.description}</span>}
            </span>
            {item.shortcut && <Kbd shortcut={item.shortcut} variant="plain" className="sb-menu__shortcut" />}
            {hasSubmenu && <ChevronRight size={13} className="sb-menu__chevron" aria-hidden />}
            {hasSubmenu && subOpen && (
              <Popover
                open
                onOpenChange={(open) => {
                  if (!open) setOpenSub(null);
                }}
                anchor={itemRefs.current[index] ?? null}
                placement="right-start"
                offset={4}
                crossOffset={-5}
                initialFocus="none"
                returnFocus={false}
                role="presentation"
                className="sb-menu-popover"
              >
                <MenuList
                  entries={item.submenu!}
                  submenu
                  aria-label={item.label}
                  autoFocus={openSub.viaKeyboard ? "first" : "none"}
                  onClose={(reason) => {
                    setOpenSub(null);
                    if (reason === "back" || reason === "escape") itemRefs.current[index]?.focus();
                    else onClose(reason);
                  }}
                />
              </Popover>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface TriggerProps {
  ref?: Ref<HTMLElement>;
  onClick?: MouseEventHandler<HTMLElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  "aria-haspopup"?: string;
  "aria-expanded"?: boolean;
}

export interface MenuProps {
  entries: readonly MenuEntry[] | (() => readonly MenuEntry[]);
  /** The trigger button. */
  children: ReactElement;
  placement?: Placement;
  "aria-label"?: string;
  onOpenChange?: (open: boolean) => void;
}

/** Dropdown menu attached to a trigger button. */
export function Menu({ entries, children, placement = "bottom-start", "aria-label": ariaLabel, onOpenChange }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [viaKeyboard, setViaKeyboard] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const child = Children.only(children) as ReactElement<TriggerProps>;
  const ref = useMergedRefs<HTMLElement>(setAnchor, child.props.ref);

  const set = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  const trigger = cloneElement(child, {
    ref,
    "aria-haspopup": "menu",
    "aria-expanded": open,
    onClick: (event: MouseEvent<HTMLElement>) => {
      child.props.onClick?.(event);
      if (event.defaultPrevented) return;
      setViaKeyboard(event.detail === 0);
      set(!open);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      child.props.onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setViaKeyboard(true);
        set(true);
      }
    },
  });

  const resolved = typeof entries === "function" ? (open ? entries() : []) : entries;

  return (
    <>
      {trigger}
      <Popover open={open} onOpenChange={set} anchor={anchor} placement={placement} initialFocus="none" role="presentation" className="sb-menu-popover">
        <MenuList entries={resolved} aria-label={ariaLabel} autoFocus={viaKeyboard ? "first" : "container"} onClose={() => set(false)} />
      </Popover>
    </>
  );
}

export interface ContextMenuState {
  point: Rect;
  entries: readonly MenuEntry[];
  themeFrom: Element | null;
  viaKeyboard: boolean;
}

/** Imperative context menu for surfaces like canvases: `open(event, entries)` and render `element`. */
export function useContextMenu() {
  const [state, setState] = useState<ContextMenuState | null>(null);
  const open = useCallback((event: { clientX: number; clientY: number; currentTarget?: EventTarget | null }, entries: readonly MenuEntry[]) => {
    setState({
      point: { x: event.clientX, y: event.clientY, width: 0, height: 0 },
      entries,
      themeFrom: (event.currentTarget as Element | null) ?? null,
      viaKeyboard: false,
    });
  }, []);
  const openAt = useCallback((rect: Rect, entries: readonly MenuEntry[], themeFrom: Element | null = null) => {
    setState({ point: rect, entries, themeFrom, viaKeyboard: true });
  }, []);
  const close = useCallback(() => setState(null), []);
  const element = (
    <Popover
      open={state !== null}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      anchor={state?.point ?? null}
      themeFrom={state?.themeFrom}
      placement="bottom-start"
      offset={2}
      initialFocus="none"
      role="presentation"
      className="sb-menu-popover"
    >
      {state && <MenuList entries={state.entries} autoFocus={state.viaKeyboard ? "first" : "container"} onClose={close} />}
    </Popover>
  );
  return { open, openAt, close, isOpen: state !== null, element };
}

interface ContextTargetProps {
  onContextMenu?: MouseEventHandler<HTMLElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
}

export interface ContextMenuProps {
  entries: readonly MenuEntry[] | (() => readonly MenuEntry[]);
  children: ReactElement;
  disabled?: boolean;
}

/** Right-click (or Shift+F10 / the Menu key) opens a menu at the pointer. */
export function ContextMenu({ entries, children, disabled = false }: ContextMenuProps) {
  const menu = useContextMenu();
  const child = Children.only(children) as ReactElement<ContextTargetProps>;
  const resolve = () => (typeof entries === "function" ? entries() : entries);
  const target = cloneElement(child, {
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      child.props.onContextMenu?.(event);
      if (disabled || event.defaultPrevented) return;
      event.preventDefault();
      menu.open(event, resolve());
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      child.props.onKeyDown?.(event);
      if (disabled || event.defaultPrevented) return;
      if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
        event.preventDefault();
        const r = event.currentTarget.getBoundingClientRect();
        menu.openAt({ x: r.left + 8, y: r.top + Math.min(r.height, 24), width: 0, height: 0 }, resolve(), event.currentTarget);
      }
    },
  });
  return (
    <>
      {target}
      {menu.element}
    </>
  );
}
