/**
 * A detachable in-app window: drag it by its header (or move it with arrow keys), resize it from the
 * corner, and it remembers where it was.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Portal } from "../../ui/Portal.tsx";
import { cx } from "../../ui/lib/cx.ts";
import { useLatest } from "../../ui/lib/hooks.ts";
import { readJSON, writeJSON } from "../../ui/lib/storage.ts";
import { clampFloatingRect, isFloatingRect, type FloatingRect } from "./viewerModel.ts";
import "./viewer.css";

export interface FloatingWindowProps {
  title: ReactNode;
  "aria-label": string;
  /** Buttons at the right of the header (dock, close...). */
  actions?: ReactNode;
  children: ReactNode;
  /** localStorage key for the window's position and size. */
  storageKey?: string;
  defaultRect?: Partial<FloatingRect>;
  minWidth?: number;
  minHeight?: number;
  /** Copy the theme from this element (the panel the window came from). */
  themeFrom?: Element | null;
  className?: string;
}

interface DragState {
  mode: "move" | "resize";
  pointerId: number;
  startX: number;
  startY: number;
  start: FloatingRect;
}

const viewportSize = (): [number, number] => [window.innerWidth, window.innerHeight];

export function FloatingWindow({ title, "aria-label": ariaLabel, actions, children, storageKey, defaultRect, minWidth = 260, minHeight = 340, themeFrom, className }: FloatingWindowProps) {
  const min: [number, number] = [minWidth, minHeight];
  const [rect, setRect] = useState<FloatingRect>(() => {
    const saved = storageKey ? readJSON(storageKey, isFloatingRect) : undefined;
    const [vw, vh] = viewportSize();
    const width = defaultRect?.width ?? 380;
    const height = defaultRect?.height ?? Math.min(700, vh - 120);
    return clampFloatingRect(saved ?? { x: defaultRect?.x ?? vw - width - 32, y: defaultRect?.y ?? 84, width, height }, [vw, vh], [minWidth, minHeight]);
  });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<DragState | null>(null);
  const latestRect = useLatest(rect);

  const save = () => {
    if (storageKey) writeJSON(storageKey, latestRect.current);
  };

  useEffect(() => {
    const onResize = () => setRect((r) => clampFloatingRect(r, viewportSize(), [minWidth, minHeight]));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minWidth, minHeight]);

  const begin = (mode: DragState["mode"]) => (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (mode === "move" && (event.target as Element).closest("button, input, select, [role='button']")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { mode, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, start: latestRect.current };
    setDragging(true);
  };

  const onMove = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;
    const next = d.mode === "move" ? { ...d.start, x: d.start.x + dx, y: d.start.y + dy } : { ...d.start, width: d.start.width + dx, height: d.start.height + dy };
    setRect(clampFloatingRect(next, viewportSize(), min));
  };

  const end = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    save();
  };

  const onHeaderKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    setRect((r) => clampFloatingRect({ ...r, x: r.x + move[0], y: r.y + move[1] }, viewportSize(), min));
    queueMicrotask(save);
  };

  return (
    <Portal themeFrom={themeFrom}>
      <div role="dialog" aria-modal="false" aria-label={ariaLabel} className={cx("sb-float", className)} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
        <div
          className="sb-float__header"
          tabIndex={0}
          aria-label={`${ariaLabel}: drag or use arrow keys to move`}
          data-dragging={dragging || undefined}
          onPointerDown={begin("move")}
          onPointerMove={onMove}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={onHeaderKeyDown}
        >
          <span className="sb-float__title">{title}</span>
          {actions && <div className="sb-float__actions">{actions}</div>}
        </div>
        <div className="sb-float__body">{children}</div>
        <div className="sb-float__grip" aria-hidden onPointerDown={begin("resize")} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end} />
      </div>
    </Portal>
  );
}
