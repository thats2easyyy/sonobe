/** React binding for `computePosition`: keeps a fixed-position element placed next to its anchor. */

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type RefCallback, type RefObject } from "react";
import { useLatest } from "./hooks.ts";
import { observeResize } from "./observeResize.ts";
import { computePosition, splitPlacement, type Placement, type Rect, type Side } from "./position.ts";

/** An element, or a virtual rect in viewport coordinates (e.g. a context-menu point). */
export type FloatingAnchor = Element | Rect | null;

export function isElementAnchor(anchor: FloatingAnchor | undefined): anchor is Element {
  return !!anchor && typeof (anchor as Element).getBoundingClientRect === "function";
}

export interface UseFloatingOptions {
  open: boolean;
  anchor: FloatingAnchor;
  placement?: Placement;
  offset?: number;
  crossOffset?: number;
  padding?: number;
  flip?: boolean;
  /** Set min-width to the anchor's width (selects, comboboxes). */
  matchAnchorWidth?: boolean;
}

interface FloatingState {
  x: number;
  y: number;
  side: Side;
  placement: Placement;
  maxWidth: number;
  maxHeight: number;
  anchorWidth: number;
}

export interface FloatingResult<T extends HTMLElement> {
  /** Attach to the floating element. A callback ref, so portaled content that mounts late still gets placed. */
  ref: RefCallback<T>;
  /** The mounted floating element (null until it mounts). */
  element: T | null;
  /** Always-current element, for event handlers and dismiss checks. */
  elementRef: RefObject<T | null>;
  style: CSSProperties;
  side: Side;
  placement: Placement;
  positioned: boolean;
  update: () => void;
}

function sameState(a: FloatingState, b: FloatingState): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.side === b.side &&
    a.placement === b.placement &&
    a.maxWidth === b.maxWidth &&
    a.maxHeight === b.maxHeight &&
    a.anchorWidth === b.anchorWidth
  );
}

export function useFloating<T extends HTMLElement = HTMLDivElement>(options: UseFloatingOptions): FloatingResult<T> {
  const elementRef = useRef<T | null>(null);
  const [element, setElement] = useState<T | null>(null);
  const [state, setState] = useState<FloatingState | null>(null);
  const latest = useLatest(options);

  const ref = useCallback((node: T | null) => {
    elementRef.current = node;
    setElement(node);
  }, []);

  const update = useCallback(() => {
    const el = elementRef.current;
    const { anchor, placement, offset, crossOffset, padding, flip } = latest.current;
    if (!el || !anchor) return;
    let rect: Rect;
    if (isElementAnchor(anchor)) {
      const r = anchor.getBoundingClientRect();
      rect = { x: r.left, y: r.top, width: r.width, height: r.height };
    } else {
      rect = anchor;
    }
    const result = computePosition(
      rect,
      { width: el.offsetWidth, height: el.scrollHeight },
      { width: window.innerWidth, height: window.innerHeight },
      { placement, offset, crossOffset, padding, flip },
    );
    const next: FloatingState = {
      x: result.x,
      y: result.y,
      side: result.side,
      placement: result.placement,
      maxWidth: result.maxWidth,
      maxHeight: result.maxHeight,
      anchorWidth: Math.round(rect.width),
    };
    setState((prev) => (prev && sameState(prev, next) ? prev : next));
  }, [latest]);

  const anchor = options.anchor;
  const anchorKey = isElementAnchor(anchor) ? anchor : anchor ? `${anchor.x},${anchor.y},${anchor.width},${anchor.height}` : null;

  useLayoutEffect(() => {
    if (!options.open || !element) {
      setState(null);
      return;
    }
    update();
    const onChange = () => update();
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    const currentAnchor = latest.current.anchor;
    const disconnect = observeResize([element, isElementAnchor(currentAnchor) ? currentAnchor : null], onChange);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
      disconnect();
    };
  }, [options.open, anchorKey, element, update, latest]);

  // Before the first measurement the element sits off-screen (but stays focusable).
  const style: CSSProperties = state
    ? {
        position: "fixed",
        left: state.x,
        top: state.y,
        maxWidth: state.maxWidth,
        maxHeight: state.maxHeight,
        minWidth: options.matchAnchorWidth ? state.anchorWidth : undefined,
      }
    : { position: "fixed", left: -10000, top: 0 };

  const fallback = splitPlacement(options.placement ?? "bottom-start");
  return {
    ref,
    element,
    elementRef,
    style,
    side: state?.side ?? fallback[0],
    placement: state?.placement ?? options.placement ?? "bottom-start",
    positioned: state !== null,
    update,
  };
}
