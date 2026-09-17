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

type PointerInputEvent = Extract<InputEvent, { kind: "pointer" }>;

const NAVIGATION_KEYS = new Set([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"]);
const EDITABLE_PASSTHROUGH_KEYS = new Set(["Enter", "Escape"]);

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as (Element & { isContentEditable?: boolean }) | null;
  if (!el || typeof el.closest !== "function") return false;
  return el.closest("input, textarea, select, [contenteditable]") !== null;
}

/** Normalizes PointerEvent.pointerType ("" or vendor values count as mouse). */
export function pointerTypeOf(e: { pointerType?: string }): "mouse" | "touch" | "pen" {
  return e.pointerType === "touch" || e.pointerType === "pen" ? e.pointerType : "mouse";
}

/**
 * A pointer InputEvent with the DOM `buttons` bitmask (1 primary, 2 secondary, 4 middle, 8 back,
 * 16 forward, 32 pen eraser). Declared locally so this compiles before and after the engine
 * contract gains `buttons?: number`.
 */
type PointerWithButtons = PointerInputEvent & { buttons?: number };

/** PointerEvent.button → its `buttons` bit (the two orders differ: button 1 is middle, bit 2 is secondary). */
const BUTTON_BITS = [1, 4, 2, 8, 16, 32];

/**
 * Buttons held once this event has been handled: pressed buttons are included on "down" and the
 * released button is gone on "up". Missing or invalid values read as 0 (nothing pressed), except
 * that a press reporting no buttons (some synthetic events) counts the button it pressed.
 */
export function buttonsOf(e: { buttons?: number; button?: number }, phase?: PointerInputEvent["phase"]): number {
  const b = e.buttons;
  const held = typeof b === "number" && Number.isInteger(b) && b > 0 ? b : 0;
  if (held === 0 && phase === "down") return BUTTON_BITS[e.button ?? 0] ?? 1;
  return held;
}

/** Event time in ms on the performance clock (the same clock as requestAnimationFrame). */
export function eventTime(e: { timeStamp?: number }): number {
  const t = e.timeStamp;
  return typeof t === "number" && Number.isFinite(t) && t > 0 ? t : typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Attaches listeners to the container; returns a function that removes them. */
export function attachInputCapture(opts: InputCaptureOptions): () => void {
  const { container, stage, pointer, emit } = opts;
  const pressedKeys = new Map<string, KeyboardEvent>();
  const rect = () => stage.getBoundingClientRect();
  const toPrototype = (e: { clientX: number; clientY: number }, r: ClientRectLike = rect()) => clientToPrototype(e.clientX, e.clientY, r, opts.getSize(), opts.getScale());

  const pointerEvent = (e: PointerEvent, phase: PointerInputEvent["phase"], x: number, y: number): PointerInputEvent => {
    const type = pointerTypeOf(e);
    const out: PointerWithButtons = { kind: "pointer", phase, pointerId: e.pointerId, pointerType: type, timeStamp: eventTime(e), x, y, buttons: buttonsOf(e, phase) };
    if (phase === "down" || phase === "up") out.button = e.button;
    if (type !== "mouse" && e.pressure && (phase === "down" || phase === "move")) out.pressure = e.pressure;
    return out;
  };

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
    emit([pointerEvent(e, "down", x, y)]);
  };

  const onPointerMove = (e: PointerEvent) => {
    const r = rect();
    // While pressed, coalesced samples (each with its own timestamp) sharpen drag velocity.
    const coalesced = e.buttons && typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const samples = coalesced.length > 1 ? coalesced : [e];
    const events: PointerInputEvent[] = [];
    let x = 0;
    let y = 0;
    for (const sample of samples) {
      [x, y] = toPrototype(sample, r);
      events.push(pointerEvent(sample, "move", x, y));
    }
    pointer.x = x;
    pointer.y = y;
    emit(events);
    opts.onPointerMove?.(x, y);
  };

  const onPointerUp = (e: PointerEvent) => {
    const [x, y] = toPrototype(e);
    pointer.x = x;
    pointer.y = y;
    if (!e.buttons) pointer.down = false;
    emit([pointerEvent(e, "up", x, y)]);
  };

  const onPointerCancel = (e: PointerEvent) => {
    const [x, y] = toPrototype(e);
    pointer.down = false;
    emit([pointerEvent(e, "cancel", x, y)]);
  };

  // A pointer that leaves the viewer (a hovering mouse, or a touch after it lifts) ends hover.
  // Captured drags keep reporting moves until release instead.
  const onPointerLeave = (e: PointerEvent) => {
    if (e.buttons) return;
    const [x, y] = toPrototype(e);
    emit([pointerEvent(e, "leave", x, y)]);
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
