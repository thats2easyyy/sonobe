import type { InputEvent } from "../types.ts";
import { KeyboardTracker } from "./keyboard.ts";
import { PointerTracker, type HitTestFunction, type PointerTrackerOptions } from "./pointer.ts";
import { TextInputTracker } from "./textInput.ts";
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
export { TextInputTracker, type TextFieldSnapshot } from "./textInput.ts";
export { WheelTracker, type WheelSnapshot } from "./wheel.ts";

/** Pointer, keyboard, wheel, and text-field trackers driven together once per frame. */
export class InputTracker {
  readonly pointer: PointerTracker;
  readonly keyboard = new KeyboardTracker();
  readonly wheel = new WheelTracker();
  readonly text = new TextInputTracker();

  constructor(options: Partial<PointerTrackerOptions> = {}) {
    this.pointer = new PointerTracker(options);
  }

  update(events: readonly InputEvent[], hitTest: HitTestFunction, dt: number): void {
    this.pointer.update(events, hitTest, dt);
    this.keyboard.update(events);
    this.wheel.update(events, dt);
    this.text.update(events);
  }

  endFrame(): void {
    this.pointer.endFrame();
    this.keyboard.endFrame();
    this.wheel.endFrame();
    this.text.endFrame();
  }

  reset(): void {
    this.pointer.reset();
    this.keyboard.releaseAll();
    this.keyboard.endFrame();
    this.wheel.endFrame();
    this.text.reset();
  }
}
