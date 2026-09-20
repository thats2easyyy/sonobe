/**
 * Text Field state from renderer text, focus, and submit events (layer outputs value, isFocused,
 * submitted), and from the prototype's Set Text, Begin Editing and End Editing pulses.
 */

import type { InputEvent } from "../types.ts";

export interface TextFieldSnapshot {
  /** Last text typed into the field, or undefined when nothing was typed since the last reset. */
  value: string | undefined;
  /** Focus reported by the renderer, or undefined when no focus event arrived. */
  focused: boolean | undefined;
  /** Return was pressed this frame. */
  submitted: boolean;
  /** Changes each time Set Text replaced the text (0 until it first does). */
  textRevision: number;
  /** Changes each time Begin Editing or End Editing fired (0 until one does). */
  editRevision: number;
  /** What the last of those asked for: true after Begin Editing, false after End Editing. */
  editing: boolean;
}

interface FieldState {
  value?: string;
  focused?: boolean;
  textRevision?: number;
  editRevision?: number;
  editing?: boolean;
}

/** Tracks Text Field events by SceneNode key (the event's `key`, else its `layerId`). */
export class TextInputTracker {
  private fields = new Map<string, FieldState>();
  private submits = new Set<string>();
  /** Revisions count up across restarts, so a renderer never mistakes a new command for one it already applied. */
  private revision = 0;

  /** Apply one frame of events; other event kinds are ignored. */
  update(events: readonly InputEvent[]): void {
    for (const event of events) {
      if (event.kind !== "text" && event.kind !== "focus" && event.kind !== "submit") continue;
      const key = event.key ?? event.layerId;
      const field = this.field(key);
      if (event.kind === "text") field.value = event.value;
      else if (event.kind === "focus") field.focused = event.focused;
      else this.submits.add(key);
    }
  }

  /** Replace a field's text (the prototype set the field's Text property). */
  setValue(key: string, value: string): void {
    this.field(key).value = value;
  }

  /** Set Text: replace what the field holds, even when it's the same text, and tell renderers to push it. */
  setText(key: string, value: string): void {
    const field = this.field(key);
    field.value = value;
    field.textRevision = ++this.revision;
  }

  /** Begin Editing (true) or End Editing (false): the field reads as focused or not until the renderer reports otherwise. */
  setEditing(key: string, editing: boolean): void {
    const field = this.field(key);
    field.focused = editing;
    field.editing = editing;
    field.editRevision = ++this.revision;
  }

  /** True once the field has state its layer props don't show (typed text, focus, or a command). */
  has(key: string): boolean {
    return this.fields.has(key);
  }

  snapshot(key: string): TextFieldSnapshot {
    const field = this.fields.get(key);
    return {
      value: field?.value,
      focused: field?.focused,
      submitted: this.submits.has(key),
      textRevision: field?.textRevision ?? 0,
      editRevision: field?.editRevision ?? 0,
      editing: field?.editing ?? false,
    };
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

  private field(key: string): FieldState {
    let field = this.fields.get(key);
    if (!field) this.fields.set(key, (field = {}));
    return field;
  }
}
