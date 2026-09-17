/**
 * Input capture: DOM pointer, wheel, and keyboard events on the viewer container become
 * engine InputEvents in prototype coordinates (points, origin at the prototype's top-left).
 */

import type { InputEvent } from "@sonobe/engine";

export interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Converts client coordinates to prototype coordinates. The effective scale comes from the
 * stage's on-screen size vs the prototype size (so ancestor CSS zoom is accounted for);
 * `scale` is the fallback before the stage has a size.
 */
export function clientToPrototype(
  clientX: number,
  clientY: number,
  rect: ClientRectLike,
  size: readonly [number, number] | null,
  scale: number,
): [number, number] {
  const [sx, sy] = effectiveScale(rect, size, scale);
  return [(clientX - rect.left) / sx, (clientY - rect.top) / sy];
}

export function effectiveScale(rect: ClientRectLike, size: readonly [number, number] | null, scale: number): [number, number] {
  const fallback = scale > 0 && Number.isFinite(scale) ? scale : 1;
  if (size && size[0] > 0 && size[1] > 0 && rect.width > 0 && rect.height > 0) {
    return [rect.width / size[0], rect.height / size[1]];
  }
  return [fallback, fallback];
}

/** Live pointer state (prototype coordinates), shared with shader layers for iMouse. */
export interface PointerState {
  x: number;
  y: number;
  down: boolean;
  downX: number;
  downY: number;
  /** Increments on every press; lets media retry playback after a user gesture. */
  gestures: number;
}

export interface InputCaptureOptions {
  container: HTMLElement;
  stage: HTMLElement;
  getSize: () => readonly [number, number] | null;
  getScale: () => number;
  emit: (events: InputEvent[]) => void;
  pointer: PointerState;
  onPointerMove?: (x: number, y: number) => void;
}

const NAVIGATION_KEYS = new Set([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"]);
const EDITABLE_PASSTHROUGH_KEYS = new Set(["Enter", "Escape"]);

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as (Element & { isContentEditable?: boolean }) | null;
  if (!el || typeof el.closest !== "function") return false;
  return el.closest("input, textarea, select, [contenteditable]") !== null;
}

/** Attaches listeners to the container; returns a function that removes them. */
export function attachInputCapture(opts: InputCaptureOptions): () => void {
  const { container, stage, pointer, emit } = opts;
  const pressedKeys = new Map<string, KeyboardEvent>();
  const rect = () => stage.getBoundingClientRect();
  const toPrototype = (e: { clientX: number; clientY: number }) => clientToPrototype(e.clientX, e.clientY, rect(), opts.getSize(), opts.getScale());

  const onPointerDown = (e: PointerEvent) => {
    const [x, y] = toPrototype(e);
    pointer.x = x;
    pointer.y = y;
    pointer.down = true;
    pointer.downX = x;
    pointer.downY = y;
    pointer.gestures++;
    const editable = isEditableTarget(e.target);
    if (!editable) {
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events without an active pointer cannot be captured.
      }
      if (e.pointerType === "mouse") e.preventDefault();
      if (typeof container.focus === "function") container.focus({ preventScroll: true });
    }
    emit([{ kind: "pointer", phase: "down", pointerId: e.pointerId, x, y, button: e.button, ...(e.pointerType !== "mouse" && e.pressure ? { pressure: e.pressure } : {}) }]);
  };

  const onPointerMove = (e: PointerEvent) => {
    const [x, y] = toPrototype(e);
    pointer.x = x;
    pointer.y = y;
    emit([{ kind: "pointer", phase: "move", pointerId: e.pointerId, x, y, ...(e.pointerType !== "mouse" && e.pressure ? { pressure: e.pressure } : {}) }]);
    opts.onPointerMove?.(x, y);
  };

  const onPointerUp = (e: PointerEvent) => {
    const [x, y] = toPrototype(e);
    pointer.x = x;
    pointer.y = y;
    if (!e.buttons) pointer.down = false;
    emit([{ kind: "pointer", phase: "up", pointerId: e.pointerId, x, y, button: e.button }]);
  };

  const onPointerCancel = (e: PointerEvent) => {
    const [x, y] = toPrototype(e);
    pointer.down = false;
    emit([{ kind: "pointer", phase: "cancel", pointerId: e.pointerId, x, y }]);
  };

  // A hovering mouse that leaves the viewer ends hover: report a position just outside the prototype.
  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.buttons) return;
    const size = opts.getSize();
    let [x, y] = toPrototype(e);
    if (size && x >= 0 && y >= 0 && x <= size[0] && y <= size[1]) {
      const distances = [x, size[0] - x, y, size[1] - y];
      const nearest = distances.indexOf(Math.min(...distances));
      if (nearest === 0) x = -1;
      else if (nearest === 1) x = size[0] + 1;
      else if (nearest === 2) y = -1;
      else y = size[1] + 1;
    }
    pointer.x = x;
    pointer.y = y;
    emit([{ kind: "pointer", phase: "move", pointerId: e.pointerId, x, y }]);
    opts.onPointerMove?.(x, y);
  };

  const onWheel = (e: WheelEvent) => {
    const r = rect();
    const size = opts.getSize();
    const hasClient = Number.isFinite(e.clientX) && Number.isFinite(e.clientY);
    const [x, y] = hasClient ? clientToPrototype(e.clientX, e.clientY, r, size, opts.getScale()) : [pointer.x, pointer.y];
    const [sx, sy] = effectiveScale(r, size, opts.getScale());
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (size?.[1] ?? 800) : 1;
    e.preventDefault();
    emit([{ kind: "wheel", x, y, dx: (e.deltaX * unit) / sx, dy: (e.deltaY * unit) / sy }]);
  };

  const keyId = (e: KeyboardEvent) => e.code || e.key;

  const keyEvent = (e: KeyboardEvent, phase: "down" | "up"): InputEvent => ({
    kind: "key",
    phase,
    key: e.key,
    code: e.code,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey,
    ctrl: e.ctrlKey,
  });

  const onKeyDown = (e: KeyboardEvent) => {
    const editable = isEditableTarget(e.target);
    if (editable && !EDITABLE_PASSTHROUGH_KEYS.has(e.key)) return;
    if (!editable && NAVIGATION_KEYS.has(e.key) && !e.metaKey && !e.ctrlKey) e.preventDefault();
    if (e.repeat || pressedKeys.has(keyId(e))) return;
    pressedKeys.set(keyId(e), e);
    emit([keyEvent(e, "down")]);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (!pressedKeys.has(keyId(e))) return;
    pressedKeys.delete(keyId(e));
    emit([keyEvent(e, "up")]);
  };

  // Release held keys when focus leaves, so nothing stays stuck down.
  const releaseKeys = () => {
    if (pressedKeys.size === 0) return;
    const events = [...pressedKeys.values()].map((e) => keyEvent(e, "up"));
    pressedKeys.clear();
    emit(events);
  };
  const onFocusOut = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (!next || !container.contains(next)) releaseKeys();
  };

  const onContextMenu = (e: Event) => e.preventDefault();

  const win = container.ownerDocument.defaultView;
  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerCancel);
  container.addEventListener("pointerleave", onPointerLeave);
  container.addEventListener("wheel", onWheel, { passive: false });
  container.addEventListener("keydown", onKeyDown);
  container.addEventListener("keyup", onKeyUp);
  container.addEventListener("focusout", onFocusOut);
  container.addEventListener("contextmenu", onContextMenu);
  win?.addEventListener("blur", releaseKeys);

  return () => {
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", onPointerUp);
    container.removeEventListener("pointercancel", onPointerCancel);
    container.removeEventListener("pointerleave", onPointerLeave);
    container.removeEventListener("wheel", onWheel);
    container.removeEventListener("keydown", onKeyDown);
    container.removeEventListener("keyup", onKeyUp);
    container.removeEventListener("focusout", onFocusOut);
    container.removeEventListener("contextmenu", onContextMenu);
    win?.removeEventListener("blur", releaseKeys);
  };
}
