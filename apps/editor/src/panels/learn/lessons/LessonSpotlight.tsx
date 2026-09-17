import { useEffect, useState } from "react";
import { Portal } from "../../../ui/Portal.tsx";
import type { LessonTarget } from "./types.ts";

/** The element a lesson target points at (its `closest` ancestor when given), or null. */
export function findLessonTarget(target: LessonTarget, root: ParentNode = document): Element | null {
  try {
    const element = root.querySelector(target.selector);
    return (target.closest ? element?.closest(target.closest) : null) ?? element;
  } catch {
    return null;
  }
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SIZE = 24;
const PAD = 4;

/** Rings the target of the current lesson step. It follows the element as panels move and never takes pointer events. */
export function LessonSpotlight({ target }: { target: LessonTarget | null }) {
  const [box, setBox] = useState<Box | null>(null);
  const selector = target?.selector;
  const closest = target?.closest;

  useEffect(() => {
    if (!selector) {
      setBox(null);
      return;
    }
    let frame = 0;
    let key = "";
    const tick = () => {
      const rect = findLessonTarget(closest ? { selector, closest } : { selector })?.getBoundingClientRect();
      let next: Box | null = null;
      if (rect && rect.width > 0 && rect.height > 0) {
        const width = Math.max(MIN_SIZE, rect.width);
        const height = Math.max(MIN_SIZE, rect.height);
        next = { x: Math.round(rect.x - (width - rect.width) / 2), y: Math.round(rect.y - (height - rect.height) / 2), width: Math.round(width), height: Math.round(height) };
      }
      const nextKey = next ? `${next.x},${next.y},${next.width},${next.height}` : "";
      if (nextKey !== key) {
        key = nextKey;
        setBox(next);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [selector, closest]);

  if (!box) return null;
  return (
    <Portal>
      <div className="sb-spotlight" data-lesson-spotlight aria-hidden style={{ left: box.x - PAD, top: box.y - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 }} />
    </Portal>
  );
}
