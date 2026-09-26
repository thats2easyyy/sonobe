import { useLayoutEffect, useState } from "react";
import { Tooltip } from "../../ui/Tooltip.tsx";

/** Tooltip text with its own measure: the kit tooltip sizes itself to the viewport, so long text would run on one line. */
export function Tip({ children }: { children: string }) {
  return <span className="sb-welcome__tip">{children}</span>;
}

/** A ref callback for an element and whether its text is cut off (ellipsis or line clamp) at its current size. */
export function useTruncated() {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    if (!node) return;
    const measure = () => setTruncated(node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, truncated] as const;
}

/** Text that clips to its box and shows the full text in a tooltip only when it did. */
export function TruncatedText({ text, className }: { text: string; className: string }) {
  const [ref, truncated] = useTruncated();
  return (
    <Tooltip content={<Tip>{text}</Tip>} disabled={!truncated}>
      <span ref={ref} className={className}>
        {text}
      </span>
    </Tooltip>
  );
}
