import type { InputEvent } from "../types.ts";
import { KeyboardTracker } from "./keyboard.ts";
import { PointerTracker, type HitTestFunction, type PointerTrackerOptions } from "./pointer.ts";
import { WheelTracker } from "./wheel.ts";

export { KeyboardTracker, normalizeKey } from "./keyboard.ts";
export {
  DEFAULT_VELOCITY_SMOOTHING,
  PointerTracker,
  TAP_SLOP,
  type HitTarget,
  type HitTestFunction,
  type PointerTrackerOptions,
} from "./pointer.ts";
export { WheelTracker, type WheelSnapshot } from "./wheel.ts";

/** Pointer, keyboard, and wheel trackers driven together once per frame. */
export class InputTracker {
  readonly pointer: PointerTracker;
  readonly keyboard = new KeyboardTracker();
  readonly wheel = new WheelTracker();

  constructor(options: Partial<PointerTrackerOptions> = {}) {
    this.pointer = new PointerTracker(options);
  }

  update(events: readonly InputEvent[], hitTest: HitTestFunction, dt: number): void {
    this.pointer.update(events, hitTest, dt);
    this.keyboard.update(events);
    this.wheel.update(events, dt);
  }

  endFrame(): void {
    this.pointer.endFrame();
    this.keyboard.endFrame();
    this.wheel.endFrame();
  }

  reset(): void {
    this.pointer.reset();
    this.keyboard.releaseAll();
    this.keyboard.endFrame();
    this.wheel.endFrame();
  }
}
