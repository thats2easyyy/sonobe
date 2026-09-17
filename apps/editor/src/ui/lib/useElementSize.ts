import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { observeResize } from "./observeResize.ts";

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Tracks an element's client size. It measures once on mount, then on the frame after each resize
 * (observeResize), so a layout that depends on the size can't feed back into the observer.
 */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, ElementSize] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setSize((current) => (current.width === el.clientWidth && current.height === el.clientHeight ? current : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    return observeResize([el], measure);
  }, []);
  return [ref, size];
}
