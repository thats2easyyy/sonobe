import { Link2 } from "lucide-react";
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cx } from "./lib/cx.ts";
import { useLatest } from "./lib/hooks.ts";
import { MAX_DECIMALS, clamp, createScrubSession, formatNumber, nudgeValue, parseNumberInput, roundTo, type ScrubSession } from "./lib/scrubMath.ts";
import "./ScrubNumberField.css";

export interface NumberChangeMeta {
  source: "scrub" | "keyboard" | "input";
  /** Change since the previous emitted value; apply it relatively to mixed selections. */
  delta: number;
}

export interface ScrubNumberFieldProps {
  value: number;
  /** Fires continuously while scrubbing and on each nudge or typed commit. */
  onChange?: (value: number, meta: NumberChangeMeta) => void;
  /** Fires once per gesture (drag end, Enter/blur after typing, each arrow press). Use for undo groups. */
  onCommit?: (value: number) => void;
  /** Inline label that doubles as a scrub handle ("X", "W", an icon). */
  label?: ReactNode;
  "aria-label"?: string;
  /** Suffix like "pt", "°", "%", "s". */
  unit?: string;
  /** Display multiplier; opacity 0..1 shown as 0..100% uses scale 100. */
  scale?: number;
  min?: number;
  max?: number;
  /** Base step in value units for arrows (±1×, Shift ±10×, Alt ±0.1×) and scrubbing. */
  step?: number;
  /** Max decimals shown. */
  precision?: number;
  /** Pointer travel (px) per step while scrubbing. */
  pixelsPerStep?: number;
  /** Several different values are selected. */
  mixed?: boolean;
  disabled?: boolean;
  /** Driven by a patch; shows the live value read-only. */
  linked?: boolean;
  onLinkedClick?: () => void;
  size?: "sm" | "md";
  /** Hide the cursor and use raw movement while scrubbing. Default true. */
  pointerLock?: boolean;
  placeholder?: string;
  id?: string;
  className?: string;
}

interface Gesture {
  pointerId: number;
  target: HTMLElement;
  startX: number;
  startY: number;
  lastX: number;
  wasLocked: boolean;
  moved: boolean;
  session: ScrubSession | null;
  startValue: number;
  lastValue: number;
}

const DRAG_THRESHOLD = 3;

function requestLock(el: HTMLElement) {
  try {
    const result = el.requestPointerLock?.() as unknown;
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch(() => undefined);
    }
  } catch {
    // Pointer lock unavailable; pointer capture keeps the drag working.
  }
}

/**
 * Number input designed for inspectors: drag anywhere on it to scrub (Shift ×10, Alt ×0.1), click
 * to type (arithmetic like `667-49-64.5` works), arrows to nudge, Escape to revert.
 */
export function ScrubNumberField({
  value,
  onChange,
  onCommit,
  label,
  "aria-label": ariaLabel,
  unit,
  scale = 1,
  min,
  max,
  step = 1,
  precision = 3,
  pixelsPerStep = 2,
  mixed = false,
  disabled = false,
  linked = false,
  onLinkedClick,
  size = "md",
  pointerLock = true,
  placeholder,
  id,
  className,
}: ScrubNumberFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const gesture = useRef<Gesture | null>(null);
  // The draft lives in a ref too, so a blur fired right after Escape sees the cleared draft.
  const draftRef = useRef<string | null>(null);
  const [draft, setDraftState] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const latest = useLatest({ value, onChange, onCommit, min, max, step, pixelsPerStep, pointerLock, mixed });
  const editable = !disabled && !linked;
  const displayText = mixed ? "" : formatNumber(value * scale, precision);

  const setDraft = (next: string | null) => {
    draftRef.current = next;
    setDraftState(next);
  };

  const finishGesture = (mode: "commit" | "revert" | "click") => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    try {
      if (g.target.hasPointerCapture(g.pointerId)) g.target.releasePointerCapture(g.pointerId);
    } catch {
      // Capture already released.
    }
    if (document.pointerLockElement === g.target) document.exitPointerLock?.();
    document.documentElement.removeAttribute("data-scrubbing");
    if (g.moved) {
      setScrubbing(false);
      if (mode === "revert") {
        if (g.lastValue !== g.startValue) latest.current.onChange?.(g.startValue, { source: "scrub", delta: g.startValue - g.lastValue });
      } else {
        latest.current.onCommit?.(g.lastValue);
      }
    } else if (mode === "click") {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  useEffect(() => {
    if (!scrubbing) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      finishGesture("revert");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrubbing]);

  useEffect(
    () => () => {
      if (gesture.current) document.documentElement.removeAttribute("data-scrubbing");
    },
    [],
  );

  const commitDraft = () => {
    const current = draftRef.current;
    if (current === null) return;
    setDraft(null);
    const parsed = parseNumberInput(current);
    if (parsed === null) return;
    const next = clamp(roundTo(parsed / scale, MAX_DECIMALS), { min, max });
    if (mixed || next !== value) {
      onChange?.(next, { source: "input", delta: next - value });
      onCommit?.(next);
    }
  };

  const selectSoon = () => requestAnimationFrame(() => inputRef.current?.select());

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!editable) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const typed = draftRef.current !== null ? parseNumberInput(draftRef.current) : null;
      const current = typed !== null ? typed / scale : mixed ? 0 : value;
      const next = nudgeValue(current, event.key === "ArrowUp" ? 1 : -1, { step, min, max, modifiers: event });
      onChange?.(next, { source: "keyboard", delta: next - current });
      onCommit?.(next);
      setDraft(null);
      selectSoon();
    } else if (event.key === "Enter") {
      event.preventDefault();
      commitDraft();
      selectSoon();
    } else if (event.key === "Escape") {
      if (draftRef.current !== null && draftRef.current !== displayText) {
        event.preventDefault();
        event.stopPropagation();
      }
      setDraft(null);
      inputRef.current?.blur();
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!editable || event.button !== 0 || gesture.current) return;
    if ((event.target as Element).closest(".sb-scrub__link")) return;
    const input = inputRef.current;
    if (input && document.activeElement === input && event.target === input) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const start = mixed ? 0 : value;
    gesture.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      wasLocked: false,
      moved: false,
      session: null,
      startValue: start,
      lastValue: start,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    const locked = document.pointerLockElement === g.target;
    let dx: number;
    if (locked) {
      dx = event.movementX;
    } else {
      dx = g.wasLocked ? 0 : event.clientX - g.lastX;
      g.lastX = event.clientX;
    }
    g.wasLocked = locked;

    if (!g.moved) {
      if (Math.abs(event.clientX - g.startX) < DRAG_THRESHOLD && Math.abs(event.clientY - g.startY) < DRAG_THRESHOLD) return;
      g.moved = true;
      dx = event.clientX - g.startX;
      inputRef.current?.blur();
      const opts = latest.current;
      g.session = createScrubSession({ startValue: g.startValue, step: opts.step, min: opts.min, max: opts.max, pixelsPerStep: opts.pixelsPerStep });
      setScrubbing(true);
      document.documentElement.setAttribute("data-scrubbing", "");
      if (opts.pointerLock) requestLock(g.target);
    }

    const next = g.session!.move(dx, event);
    if (next !== g.lastValue) {
      const delta = next - g.lastValue;
      g.lastValue = next;
      latest.current.onChange?.(next, { source: "scrub", delta });
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.pointerId === event.pointerId) finishGesture("click");
  };

  const onPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.pointerId === event.pointerId) finishGesture("commit");
  };

  const onFocus = (event: FocusEvent<HTMLInputElement>) => {
    if (!editable) return;
    setDraft(displayText);
    const el = event.currentTarget;
    requestAnimationFrame(() => {
      if (document.activeElement === el) el.select();
    });
  };

  return (
    <div
      className={cx("sb-scrub", className)}
      data-size={size}
      data-scrubbing={scrubbing || undefined}
      data-disabled={disabled || undefined}
      data-linked={linked || undefined}
      data-mixed={mixed || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {label !== undefined && (
        <span className="sb-scrub__label" aria-hidden>
          {label}
        </span>
      )}
      <input
        ref={inputRef}
        id={id}
        className="sb-scrub__input"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        role="spinbutton"
        aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
        aria-valuenow={mixed ? undefined : roundTo(value * scale, precision)}
        aria-valuemin={min !== undefined ? min * scale : undefined}
        aria-valuemax={max !== undefined ? max * scale : undefined}
        aria-valuetext={mixed ? "Mixed" : `${displayText}${unit ?? ""}`}
        disabled={disabled}
        readOnly={linked}
        value={draft ?? displayText}
        placeholder={mixed ? (placeholder ?? "Mixed") : placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={onFocus}
        onBlur={commitDraft}
        onKeyDown={onKeyDown}
      />
      {unit && !mixed && (
        <span className="sb-scrub__unit" aria-hidden>
          {unit}
        </span>
      )}
      {linked && (
        <button type="button" className="sb-scrub__link" aria-label="Reveal the patch driving this value" onClick={onLinkedClick}>
          <Link2 size={12} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
