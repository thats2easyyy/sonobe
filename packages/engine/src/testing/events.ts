/** Input event generators. Scripts are per-frame lists: script[i] is dispatched before frame i. */

import type { InputEvent } from "../types.ts";

export type FrameEvents = InputEvent[][];

export interface PointerOptions {
  pointerId?: number;
  pointerType?: "mouse" | "touch" | "pen";
}

/** One pointer event in prototype coordinates. */
export function pointerEvent(phase: "down" | "move" | "up" | "cancel" | "leave", x: number, y: number, options: PointerOptions = {}): InputEvent {
  const event: InputEvent = { kind: "pointer", phase, pointerId: options.pointerId ?? 1, x, y };
  if (options.pointerType) event.pointerType = options.pointerType;
  return event;
}

/** Press at (x, y), hold for `holdFrames` frames (default 1), then release in place. */
export function tap(x: number, y: number, options: PointerOptions & { holdFrames?: number } = {}): FrameEvents {
  const hold = Math.max(1, Math.floor(options.holdFrames ?? 1));
  return [[pointerEvent("down", x, y, options)], ...Array.from({ length: hold - 1 }, () => []), [pointerEvent("up", x, y, options)]];
}

/** Press at `from`, move to `to` over `frames` frames (default 10), then release unless `release` is false. */
export function drag(from: readonly [number, number], to: readonly [number, number], options: PointerOptions & { frames?: number; release?: boolean } = {}): FrameEvents {
  const frames = Math.max(1, Math.floor(options.frames ?? 10));
  const out: FrameEvents = [[pointerEvent("down", from[0], from[1], options)]];
  for (let i = 1; i <= frames; i++) {
    const t = i / frames;
    out.push([pointerEvent("move", from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, options)]);
  }
  if (options.release !== false) out.push([pointerEvent("up", to[0], to[1], options)]);
  return out;
}

/** Key down on one frame, key up on the next. */
export function keyPress(key: string): FrameEvents {
  return [[{ kind: "key", phase: "down", key }], [{ kind: "key", phase: "up", key }]];
}

/** `frames` frames without events. */
export function idle(frames: number): FrameEvents {
  return Array.from({ length: Math.max(0, Math.floor(frames)) }, () => []);
}

/** Concatenate scripts. */
export function sequence(...parts: FrameEvents[]): FrameEvents {
  return parts.flat(1) as FrameEvents;
}
