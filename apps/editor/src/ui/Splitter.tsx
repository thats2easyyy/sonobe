import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clamp } from "./lib/scrubMath.ts";
import { cx } from "./lib/cx.ts";
import { useLatest } from "./lib/hooks.ts";
import "./Splitter.css";

export interface SplitterProps {
  /** "vertical": a vertical bar between side-by-side panes. "horizontal": a bar between stacked panes. */
  orientation: "vertical" | "horizontal";
  /** Current size (px) of the pane this splitter controls. */
  size: number;
  min?: number;
  max?: number;
  /** Double-click resets to this size. */
  defaultSize?: number;
  /** Set when the controlled pane is after the splitter (dragging toward it shrinks it). */
  invert?: boolean;
  /** Accessible name, e.g. "Resize layers panel". */
  label: string;
  /** id of the controlled pane. */
  controls?: string;
  onResize: (size: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: (size: number) => void;
  /** Enter toggles collapse. */
  onToggleCollapse?: () => void;
  className?: string;
}

/** A 1px hairline with a wide hit area. Drag, or focus and use arrow keys (Shift for bigger steps). */
export function Splitter({
  orientation,
  size,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  defaultSize,
  invert = false,
  label,
  controls,
  onResize,
  onResizeStart,
  onResizeEnd,
  onToggleCollapse,
  className,
}: SplitterProps) {
  const drag = useRef<{ pointerId: number; start: number; startSize: number; last: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const latest = useLatest({ size, min, max, invert, onResize, onResizeEnd });
  const vertical = orientation === "vertical";

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, start: vertical ? event.clientX : event.clientY, startSize: size, last: size };
    setDragging(true);
    document.documentElement.setAttribute("data-resizing", orientation);
    onResizeStart?.();
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    const { min: lo, max: hi, invert: inv, onResize: resize } = latest.current;
    const delta = (vertical ? event.clientX : event.clientY) - d.start;
    const next = Math.round(clamp(d.startSize + (inv ? -delta : delta), { min: lo, max: hi }));
    if (next !== d.last) {
      d.last = next;
      resize(next);
    }
  };

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    document.documentElement.removeAttribute("data-resizing");
    latest.current.onResizeEnd?.(d.last);
  };

  const setSize = (next: number) => {
    const clamped = Math.round(clamp(next, { min, max }));
    onResize(clamped);
    onResizeEnd?.(clamped);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 50 : 10;
    const growKey = vertical ? (invert ? "ArrowLeft" : "ArrowRight") : invert ? "ArrowUp" : "ArrowDown";
    const shrinkKey = vertical ? (invert ? "ArrowRight" : "ArrowLeft") : invert ? "ArrowDown" : "ArrowUp";
    if (event.key === growKey) setSize(size + step);
    else if (event.key === shrinkKey) setSize(size - step);
    else if (event.key === "Home") setSize(min);
    else if (event.key === "End" && Number.isFinite(max)) setSize(max);
    else if (event.key === "Enter" && onToggleCollapse) onToggleCollapse();
    else return;
    event.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={Math.round(size)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Number.isFinite(max) ? Math.round(max) : undefined}
      tabIndex={0}
      className={cx("sb-splitter", className)}
      data-orientation={orientation}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={defaultSize !== undefined ? () => setSize(defaultSize) : undefined}
      onKeyDown={onKeyDown}
    />
  );
}
