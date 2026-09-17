import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./lib/cx.ts";
import "./Tabs.css";

export interface TabItem<V extends string = string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  /** Count or status shown after the label. */
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<V extends string = string> {
  items: readonly TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  "aria-label": string;
  /** Shared with TabPanel to wire aria-controls / aria-labelledby. */
  idBase: string;
  variant?: "underline" | "pill";
  size?: "sm" | "md";
  className?: string;
}

export const tabId = (base: string, value: string) => `${base}-tab-${value}`;
export const tabPanelId = (base: string, value: string) => `${base}-panel-${value}`;

/** Tab list with roving focus; arrow keys move and activate. */
export function Tabs<V extends string = string>({
  items,
  value,
  onChange,
  "aria-label": ariaLabel,
  idBase,
  variant = "underline",
  size = "md",
  className,
}: TabsProps<V>) {
  const refs = useRef(new Map<V, HTMLButtonElement>());
  const enabled = items.filter((i) => !i.disabled);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = enabled.findIndex((i) => i.value === value);
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % enabled.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabled.length - 1;
    else return;
    event.preventDefault();
    const item = enabled[next];
    if (!item) return;
    onChange(item.value);
    refs.current.get(item.value)?.focus();
  };

  return (
    <div role="tablist" aria-label={ariaLabel} className={cx("sb-tabs", className)} data-variant={variant} data-size={size} onKeyDown={onKeyDown}>
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              if (el) refs.current.set(item.value, el);
              else refs.current.delete(item.value);
            }}
            type="button"
            role="tab"
            id={tabId(idBase, item.value)}
            aria-controls={tabPanelId(idBase, item.value)}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            className="sb-tabs__tab"
            data-selected={selected || undefined}
            onClick={() => onChange(item.value)}
          >
            {item.icon && (
              <span className="sb-tabs__icon" aria-hidden>
                {item.icon}
              </span>
            )}
            <span className="sb-tabs__label">{item.label}</span>
            {item.badge !== undefined && item.badge !== null && <span className="sb-tabs__badge">{item.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  idBase: string;
  value: string;
  active: boolean;
  children: ReactNode;
  /** Keep hidden panels mounted (preserves scroll and state). */
  keepMounted?: boolean;
  className?: string;
}

export function TabPanel({ idBase, value, active, children, keepMounted = false, className }: TabPanelProps) {
  if (!active && !keepMounted) return null;
  return (
    <div role="tabpanel" id={tabPanelId(idBase, value)} aria-labelledby={tabId(idBase, value)} hidden={!active} className={className}>
      {children}
    </div>
  );
}
