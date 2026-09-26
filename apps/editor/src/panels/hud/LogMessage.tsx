import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const measurers = new WeakMap<Element, () => void>();
let sizeObserver: ResizeObserver | undefined;
const observeSize = () =>
  (sizeObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) measurers.get(entry.target)?.();
  }));

/** A log message stays at three lines until the person asks for the rest; the whole text is always in the DOM. */
export function LogMessage({ text, expanded, onToggle, trailing }: { text: string; expanded: boolean; onToggle: () => void; trailing?: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    measurers.set(el, measure);
    observeSize().observe(el);
    return () => {
      measurers.delete(el);
      sizeObserver?.unobserve(el);
    };
  }, [text, expanded]);

  return (
    <div className="sb-logrow__body">
      <div className="sb-logrow__text">
        <span className="sb-logrow__message" ref={ref}>
          {text}
        </span>
        {trailing}
      </div>
      {overflowing && (
        <button type="button" className="sb-logrow__more" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}
