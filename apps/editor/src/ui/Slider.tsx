import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "./lib/cx.ts";
import { useLatest } from "./lib/hooks.ts";
import { clamp, decimalsOf, roundTo, stepMultiplier } from "./lib/scrubMath.ts";
import "./Slider.css";

/** A mark on the track: another preset's value, say. */
export interface SliderTick {
  value: number;
  /** What the mark is, for its tooltip and accessible name ("Shipped app: 0 s"). */
  label: string;
  /** CSS color. Default: the secondary text color. */
  color?: string;
  /** Clicking the mark (it doesn't move the thumb by itself). */
  onSelect?: () => void;
}

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  /** Snapping for drags and the arrow step (Shift ×10, Alt ×0.1). Default: a hundredth of the range. */
  step?: number;
  /** Fires while dragging and on each key press. */
  onChange: (value: number) => void;
  /** Once per gesture: pointer up, and each key press. Use it to end an undo group. */
  onCommit?: (value: number) => void;
  ticks?: readonly SliderTick[];
  "aria-label": string;
  /** The value for people and screen readers, with its unit ("95 pt"). Default: the number. */
  valueText?: (value: number) => string;
  /** "horizontal" leaves ↑ and ↓ to the surrounding list (rows that move with them). Default "both". */
  arrowKeys?: "both" | "horizontal";
  disabled?: boolean;
  className?: string;
}

const ratioOf = (value: number, min: number, max: number) => (max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0);

/** Snap to multiples of `step` from `min`, without float noise. */
function snap(value: number, min: number, step: number): number {
  if (!(step > 0)) return value;
  return roundTo(min + Math.round((value - min) / step) * step, Math.max(decimalsOf(step), decimalsOf(min)));
}

/**
 * A horizontal slider over a soft range: drag the track or the thumb, or use the keyboard (arrows
 * step, ⇧ ×10, ⌥ ×0.1, Page Up and Down ×10, Home and End). A value outside the range pins the thumb
 * to that end with an overflow caret instead of moving it; the slider itself never produces one.
 * Ticks mark other values, such as the same knob in other presets.
 */
export function Slider({ value, min, max, step, onChange, onCommit, ticks = [], "aria-label": ariaLabel, valueText, arrowKeys = "both", disabled = false, className }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; last: number } | null>(null);
  const baseStep = step !== undefined && step > 0 ? step : (max - min) / 100 || 1;
  const latest = useLatest({ value, onChange, onCommit, min, max, baseStep });
  const overflow = value > max ? "above" : value < min ? "below" : undefined;
  const text = valueText ? valueText(value) : String(roundTo(value, 6));

  const valueAt = (clientX: number, altKey: boolean) => {
    const rect = trackRef.current?.getBoundingClientRect();
    const { min: lo, max: hi, baseStep: s } = latest.current;
    if (!rect || rect.width <= 0) return latest.current.value;
    const raw = lo + ((clientX - rect.left) / rect.width) * (hi - lo);
    return clamp(snap(clamp(raw, { min: lo, max: hi }), lo, altKey ? s / 10 : s), { min: lo, max: hi });
  };

  const emit = (next: number) => {
    if (drag.current) drag.current.last = next;
    if (next !== latest.current.value) latest.current.onChange(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0 || drag.current) return;
    if ((event.target as Element).closest(".sb-slider__tick")) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, last: latest.current.value };
    setDragging(true);
    emit(valueAt(event.clientX, event.altKey));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    emit(valueAt(event.clientX, event.altKey));
  };

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (g?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Capture already released.
    }
    latest.current.onCommit?.(g.last);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const { value: current, min: lo, max: hi, baseStep: s } = latest.current;
    const unit = s * stepMultiplier(event);
    let next: number | undefined;
    const up = event.key === "ArrowRight" || (arrowKeys === "both" && event.key === "ArrowUp");
    const down = event.key === "ArrowLeft" || (arrowKeys === "both" && event.key === "ArrowDown");
    // Keys step from inside the range: a value past an end starts from that end.
    const from = clamp(current, { min: lo, max: hi });
    if (up) next = from + unit;
    else if (down) next = from - unit;
    else if (event.key === "PageUp") next = from + s * 10;
    else if (event.key === "PageDown") next = from - s * 10;
    else if (event.key === "Home") next = lo;
    else if (event.key === "End") next = hi;
    else return;
    event.preventDefault();
    event.stopPropagation();
    const snapped = clamp(roundTo(next, Math.max(decimalsOf(unit), decimalsOf(from), decimalsOf(lo))), { min: lo, max: hi });
    if (snapped !== current) latest.current.onChange(snapped);
    latest.current.onCommit?.(snapped);
  };

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={overflow ? `${text}, ${overflow === "above" ? "above" : "below"} the range` : text}
      aria-orientation="horizontal"
      aria-disabled={disabled || undefined}
      className={cx("sb-slider", className)}
      data-dragging={dragging || undefined}
      data-disabled={disabled || undefined}
      data-overflow={overflow}
      style={{ "--sb-slider-ratio": ratioOf(value, min, max) } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={onKeyDown}
    >
      <div ref={trackRef} className="sb-slider__track">
        <span className="sb-slider__fill" aria-hidden />
        {ticks.map((tick, i) => (
          <button
            key={`${i}-${tick.label}`}
            type="button"
            tabIndex={-1}
            className="sb-slider__tick"
            aria-label={tick.label}
            title={tick.label}
            disabled={disabled || !tick.onSelect}
            data-outside={tick.value < min || tick.value > max || undefined}
            style={{ "--sb-tick-ratio": ratioOf(tick.value, min, max), ...(tick.color ? { "--sb-tick-color": tick.color } : {}) } as CSSProperties}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              tick.onSelect?.();
            }}
          />
        ))}
        <span className="sb-slider__thumb" aria-hidden />
        {overflow && <span className="sb-slider__caret" aria-hidden />}
      </div>
    </div>
  );
}
