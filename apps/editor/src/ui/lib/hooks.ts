/** Small React hooks shared by the widget kit. */

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type Ref, type RefCallback, type RefObject } from "react";

/** A ref that always holds the latest value, for stable callbacks that read fresh props. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** A stable function identity that always calls the latest implementation. */
export function useEventCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useLatest(fn);
  return useCallback((...args: A) => ref.current(...args), [ref]);
}

/** Controlled when `controlled` is defined, otherwise internal state seeded from `defaultValue`. */
export function useControllableState<T>(
  controlled: T | undefined,
  defaultValue: T | (() => T),
  onChange?: (value: T) => void,
): [T, (next: T) => void] {
  const [internal, setInternal] = useState<T>(defaultValue);
  const isControlled = controlled !== undefined;
  const value = isControlled ? controlled : internal;
  const onChangeRef = useLatest(onChange);
  const setValue = useCallback(
    (next: T) => {
      if (!isControlled) setInternal(() => next);
      onChangeRef.current?.(next);
    },
    [isControlled, onChangeRef],
  );
  return [value, setValue];
}

export function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as RefObject<T | null>).current = value;
}

/** Combine several refs into one callback ref. */
export function useMergedRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (node: T | null) => refs.forEach((ref) => assignRef(ref, node)), refs);
}

export interface PointerDragHandlers<T extends Element> {
  /** Return false to ignore this press. */
  onStart?: (event: PointerEvent<T>) => boolean | void;
  onMove: (event: PointerEvent<T>) => void;
  onEnd?: (event: PointerEvent<T>, cancelled: boolean) => void;
}

/** Pointer-capture drag for sliders and pads: fires onMove on press and every move until release. */
export function usePointerDrag<T extends Element>(handlers: PointerDragHandlers<T>) {
  const active = useRef<number | null>(null);
  const latest = useLatest(handlers);
  return useMemo(
    () => ({
      onPointerDown(event: PointerEvent<T>) {
        if (event.button !== 0 || latest.current.onStart?.(event) === false) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        active.current = event.pointerId;
        (event.currentTarget as unknown as HTMLElement).focus?.({ preventScroll: true });
        latest.current.onMove(event);
      },
      onPointerMove(event: PointerEvent<T>) {
        if (active.current === event.pointerId) latest.current.onMove(event);
      },
      onPointerUp(event: PointerEvent<T>) {
        if (active.current !== event.pointerId) return;
        active.current = null;
        latest.current.onEnd?.(event, false);
      },
      onPointerCancel(event: PointerEvent<T>) {
        if (active.current !== event.pointerId) return;
        active.current = null;
        latest.current.onEnd?.(event, true);
      },
    }),
    [latest],
  );
}
