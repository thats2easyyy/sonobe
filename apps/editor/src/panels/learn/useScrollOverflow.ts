import { useEffect, useState } from "react";
import { observeResize } from "../../ui/lib/observeResize.ts";

export interface ScrollOverflow {
  /** The content is wider than the scroller. */
  overflowing: boolean;
  /** There is more to scroll to on the right. */
  more: boolean;
}

export interface ScrollOverflowHandle<T extends HTMLElement> extends ScrollOverflow {
  ref: (node: T | null) => void;
  node: T | null;
}

/** Whether a horizontal scroller clips its content, and whether more lies to the right. Pass `ref` to the scroller. */
export function useScrollOverflow<T extends HTMLElement>(): ScrollOverflowHandle<T> {
  const [node, setNode] = useState<T | null>(null);
  const [state, setState] = useState<ScrollOverflow>({ overflowing: false, more: false });

  useEffect(() => {
    if (!node) return;
    const measure = () => {
      const overflowing = node.scrollWidth - node.clientWidth > 1;
      const more = overflowing && node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
      setState((previous) => (previous.overflowing === overflowing && previous.more === more ? previous : { overflowing, more }));
    };
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    const stop = observeResize([node, ...Array.from(node.children)], measure);
    return () => {
      node.removeEventListener("scroll", measure);
      stop();
    };
  }, [node]);

  return { ref: setNode, node, ...state };
}
