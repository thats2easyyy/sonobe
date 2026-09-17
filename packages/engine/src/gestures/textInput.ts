/** Text Field state from renderer text, focus, and submit events (layer outputs value, isFocused, submitted). */

import type { InputEvent } from "../types.ts";

export interface TextFieldSnapshot {
  /** Last text typed into the field, or undefined when nothing was typed since the last reset. */
  value: string | undefined;
  /** Focus reported by the renderer, or undefined when no focus event arrived. */
  focused: boolean | undefined;
  /** Return was pressed this frame. */
  submitted: boolean;
}

/** Tracks Text Field events by SceneNode key (the event's `key`, else its `layerId`). */
export class TextInputTracker {
  private fields = new Map<string, { value?: string; focused?: boolean }>();
  private submits = new Set<string>();

  /** Apply one frame of events; other event kinds are ignored. */
  update(events: readonly InputEvent[]): void {
    for (const event of events) {
      if (event.kind !== "text" && event.kind !== "focus" && event.kind !== "submit") continue;
      const key = event.key ?? event.layerId;
      let field = this.fields.get(key);
      if (!field) this.fields.set(key, (field = {}));
      if (event.kind === "text") field.value = event.value;
      else if (event.kind === "focus") field.focused = event.focused;
      else this.submits.add(key);
    }
  }

  /** Replace a field's text (the prototype set the field's Text property). */
  setValue(key: string, value: string): void {
    const field = this.fields.get(key);
    if (field) field.value = value;
    else this.fields.set(key, { value });
  }

  snapshot(key: string): TextFieldSnapshot {
    const field = this.fields.get(key);
    return { value: field?.value, focused: field?.focused, submitted: this.submits.has(key) };
  }

  /** Clear one-frame submit flags. */
  endFrame(): void {
    this.submits.clear();
  }

  /** Forget typed text and focus (prototype restart). */
  reset(): void {
    this.fields.clear();
    this.submits.clear();
  }
}
