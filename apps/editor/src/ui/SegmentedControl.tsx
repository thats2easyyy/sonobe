import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Tooltip } from "./Tooltip.tsx";
import { cx } from "./lib/cx.ts";
import "./SegmentedControl.css";

export interface SegmentedOption<V extends string> {
  value: V;
  label?: ReactNode;
  icon?: ReactNode;
  tooltip?: string;
  shortcut?: string;
  disabled?: boolean;
  /** Required for icon-only options without a tooltip. */
  "aria-label"?: string;
}

export interface SegmentedControlProps<V extends string> {
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  "aria-label": string;
  size?: "sm" | "md";
  fullWidth?: boolean;
  className?: string;
}

/** Radio group styled as a segmented switch. Arrow keys move and select. */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  size = "md",
  fullWidth = false,
  className,
}: SegmentedControlProps<V>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<V, HTMLButtonElement>());
  const [indicator, setIndicator] = useState<{ x: number; width: number } | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const measure = () => {
      const el = buttons.current.get(value);
      if (!el) {
        setIndicator(null);
        return;
      }
      const next = { x: el.offsetLeft, width: el.offsetWidth };
      setIndicator((prev) => (prev && prev.x === next.x && prev.width === next.width ? prev : next));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (rootRef.current) observer?.observe(rootRef.current);
    const frame = requestAnimationFrame(() => setReady(true));
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, options]);

  const enabled = options.filter((o) => !o.disabled);
  const hasSelection = options.some((o) => o.value === value);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (enabled.length === 0) return;
    const index = enabled.findIndex((o) => o.value === value);
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % enabled.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabled.length - 1;
    else return;
    event.preventDefault();
    const option = enabled[next]!;
    onChange(option.value);
    buttons.current.get(option.value)?.focus();
  };

  return (
    <div
      ref={rootRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx("sb-segmented", className)}
      data-size={size}
      data-full={fullWidth || undefined}
      data-ready={ready || undefined}
      onKeyDown={onKeyDown}
    >
      {indicator && (
        <span className="sb-segmented__indicator" aria-hidden style={{ transform: `translateX(${indicator.x}px)`, width: indicator.width }} />
      )}
      {options.map((option, index) => {
        const selected = option.value === value;
        const button = (
          <button
            key={option.value}
            ref={(el) => {
              if (el) buttons.current.set(option.value, el);
              else buttons.current.delete(option.value);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option["aria-label"] ?? (option.label === undefined ? option.tooltip : undefined)}
            tabIndex={selected || (!hasSelection && index === 0) ? 0 : -1}
            disabled={option.disabled}
            className="sb-segmented__item"
            data-selected={selected || undefined}
            data-icon-only={option.label === undefined || undefined}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            {option.label !== undefined && <span className="sb-segmented__label">{option.label}</span>}
          </button>
        );
        return option.tooltip ? (
          <Tooltip key={option.value} content={option.tooltip} shortcut={option.shortcut}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
