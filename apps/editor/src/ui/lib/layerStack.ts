/**
 * A stack of dismissable layers (popovers, menus, dialogs). Escape closes only the topmost layer,
 * and a press outside closes layers from the top down until it reaches one that contains the
 * target, so clicking inside a color picker closes a select open above it but not the picker.
 */

import { useEffect, type RefObject } from "react";
import { useLatest } from "./hooks.ts";

export type DismissReason = "escape" | "outside";

export interface DismissableLayer {
  contains(node: Node): boolean;
  onDismiss(reason: DismissReason): void;
  escape: boolean;
  outside: boolean;
}

const stack: DismissableLayer[] = [];

function handlePointerDown(event: PointerEvent) {
  const target = event.target;
  if (!target || typeof (target as Node).nodeType !== "number") return;
  for (const layer of [...stack].reverse()) {
    if (layer.contains(target as Node)) return;
    if (!layer.outside) return;
    layer.onDismiss("outside");
  }
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const top = stack[stack.length - 1];
  if (!top?.escape) return;
  event.preventDefault();
  event.stopPropagation();
  top.onDismiss("escape");
}

/** Push a layer; returns a function that removes it. */
export function pushDismissableLayer(layer: DismissableLayer): () => void {
  if (stack.length === 0 && typeof document !== "undefined") {
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
  }
  stack.push(layer);
  return () => {
    const index = stack.indexOf(layer);
    if (index >= 0) stack.splice(index, 1);
    if (stack.length === 0 && typeof document !== "undefined") {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    }
  };
}

/** Number of open layers (for tests and debugging). */
export function dismissableLayerCount(): number {
  return stack.length;
}

export interface DismissableLayerOptions {
  escape?: boolean;
  outside?: boolean;
}

/** Register a dismissable layer while `open`. `refs` are the elements that count as inside. */
export function useDismissableLayer(
  open: boolean,
  onDismiss: (reason: DismissReason) => void,
  refs: readonly RefObject<Element | null>[],
  options: DismissableLayerOptions = {},
): void {
  const latestDismiss = useLatest(onDismiss);
  const latestRefs = useLatest(refs);
  const escape = options.escape ?? true;
  const outside = options.outside ?? true;
  useEffect(() => {
    if (!open) return;
    return pushDismissableLayer({
      contains: (node) => latestRefs.current.some((ref) => ref.current?.contains(node)),
      onDismiss: (reason) => latestDismiss.current(reason),
      escape,
      outside,
    });
  }, [open, escape, outside, latestDismiss, latestRefs]);
}
