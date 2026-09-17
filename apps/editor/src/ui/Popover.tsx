import { useLayoutEffect, useRef, type AriaRole, type CSSProperties, type KeyboardEventHandler, type ReactNode, type RefObject } from "react";
import { Portal } from "./Portal.tsx";
import { cx } from "./lib/cx.ts";
import { getFocusable } from "./lib/focus.ts";
import { useLatest } from "./lib/hooks.ts";
import { useDismissableLayer } from "./lib/layerStack.ts";
import type { Placement } from "./lib/position.ts";
import { isElementAnchor, useFloating, type FloatingAnchor } from "./lib/useFloating.ts";
import "./Popover.css";

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Element or viewport rect to position against. */
  anchor: FloatingAnchor;
  placement?: Placement;
  offset?: number;
  crossOffset?: number;
  flip?: boolean;
  matchAnchorWidth?: boolean;
  /** Where focus goes on open. Default "first" focusable descendant. */
  initialFocus?: "first" | "container" | "none" | RefObject<HTMLElement | null>;
  /** Restore focus to the previously focused element on close. Default true. */
  returnFocus?: boolean;
  closeOnEscape?: boolean;
  closeOnOutside?: boolean;
  /** Additional elements that count as inside (the anchor element is included automatically). */
  insideRefs?: readonly RefObject<Element | null>[];
  /** Theme source when the anchor is a rect. */
  themeFrom?: Element | null;
  /** Apply the elevated surface (background, radius, shadow). Default true. */
  surface?: boolean;
  role?: AriaRole;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  id?: string;
  className?: string;
  style?: CSSProperties;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  children: ReactNode;
}

/** A positioned, dismissable overlay (Escape, outside press) that manages focus. */
export function Popover(props: PopoverProps) {
  if (!props.open) return null;
  return <PopoverContent {...props} />;
}

function PopoverContent({
  onOpenChange,
  anchor,
  placement = "bottom-start",
  offset,
  crossOffset,
  flip,
  matchAnchorWidth,
  initialFocus = "first",
  returnFocus = true,
  closeOnEscape = true,
  closeOnOutside = true,
  insideRefs = [],
  themeFrom,
  surface = true,
  role = "dialog",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  id,
  className,
  style,
  onKeyDown,
  children,
}: PopoverProps) {
  const floating = useFloating<HTMLDivElement>({ open: true, anchor, placement, offset, crossOffset, flip, matchAnchorWidth });
  const anchorElement = isElementAnchor(anchor) ? anchor : null;
  const anchorRef = useLatest<Element | null>(anchorElement);
  const initialFocusRef = useLatest(initialFocus);
  const returnFocusRef = useLatest(returnFocus);
  const previouslyFocused = useRef<Element | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);

  useDismissableLayer(true, () => onOpenChange(false), [floating.elementRef, anchorRef, ...insideRefs], {
    escape: closeOnEscape,
    outside: closeOnOutside,
  });

  // Remember what had focus when opening; give it back on close if focus was inside or lost.
  useLayoutEffect(() => {
    previouslyFocused.current = document.activeElement;
    return () => {
      if (!returnFocusRef.current) return;
      const active = document.activeElement;
      if (!active || active === document.body || contentRef.current?.contains(active)) {
        (previouslyFocused.current as HTMLElement | null)?.focus?.({ preventScroll: true });
      }
    };
  }, [returnFocusRef]);

  // Move focus in once the portaled content has mounted.
  useLayoutEffect(() => {
    const el = floating.element;
    if (!el) return;
    contentRef.current = el;
    const target = initialFocusRef.current;
    if (target === "first") (getFocusable(el)[0] ?? el).focus({ preventScroll: true });
    else if (target === "container") el.focus({ preventScroll: true });
    else if (typeof target === "object") target.current?.focus({ preventScroll: true });
  }, [floating.element, initialFocusRef]);

  return (
    <Portal themeFrom={themeFrom ?? anchorElement}>
      <div
        ref={floating.ref}
        id={id}
        role={role}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        tabIndex={-1}
        className={cx("sb-popover", surface && "sb-surface", className)}
        data-side={floating.side}
        style={{ ...floating.style, ...style }}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </Portal>
  );
}
