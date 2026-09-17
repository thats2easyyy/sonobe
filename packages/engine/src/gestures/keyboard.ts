/** Keyboard state for the Keyboard patch and key-driven prototypes. */

import type { InputEvent, KeyboardSnapshot } from "../types.ts";

const KEY_ALIASES: Record<string, string> = {
  space: "Space",
  spacebar: "Space",
  up: "ArrowUp",
  arrowup: "ArrowUp",
  down: "ArrowDown",
  arrowdown: "ArrowDown",
  left: "ArrowLeft",
  arrowleft: "ArrowLeft",
  right: "ArrowRight",
  arrowright: "ArrowRight",
  esc: "Escape",
  escape: "Escape",
  return: "Enter",
  enter: "Enter",
  backspace: "Backspace",
  delete: "Backspace",
  del: "Delete",
  forwarddelete: "Delete",
  tab: "Tab",
  shift: "Shift",
  ctrl: "Control",
  control: "Control",
  alt: "Alt",
  option: "Alt",
  opt: "Alt",
  cmd: "Meta",
  command: "Meta",
  meta: "Meta",
  super: "Meta",
  win: "Meta",
  os: "Meta",
  capslock: "CapsLock",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
};

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

/**
 * Canonical key name: single characters lowercase ("A" → "a"), " " → "Space", and friendly
 * aliases ("cmd" → "Meta", "option" → "Alt", "up" → "ArrowUp", "return" → "Enter",
 * "delete" → "Backspace" as on Mac keyboards). Unknown names pass through.
 */
export function normalizeKey(key: string): string {
  if (key === " ") return "Space";
  if ([...key].length === 1) return key.toLowerCase();
  const alias = KEY_ALIASES[key.toLowerCase()];
  if (alias) return alias;
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
  return key;
}

/** Tracks pressed keys, per-frame transitions, and typed text. */
export class KeyboardTracker {
  private pressedKeys = new Set<string>();
  private downs = new Set<string>();
  private ups = new Set<string>();
  private typed = "";
  private cached: KeyboardSnapshot | null = null;

  /** Apply one frame of events; non-key events are ignored. */
  update(events: readonly InputEvent[]): void {
    for (const event of events) {
      if (event.kind !== "key") continue;
      const key = normalizeKey(event.key);
      if (event.phase === "down") {
        if (!this.pressedKeys.has(key)) {
          this.pressedKeys.add(key);
          this.downs.add(key);
        }
        if (!event.meta && !event.ctrl) {
          if ([...event.key].length === 1) this.typed += event.key;
          else if (key === "Enter") this.typed += "\n";
          else if (key === "Tab") this.typed += "\t";
        }
      } else {
        this.pressedKeys.delete(key);
        this.ups.add(key);
        // Browsers drop key-up events for keys released while Meta was held; don't leave them stuck.
        if (key === "Meta") {
          for (const other of [...this.pressedKeys]) {
            if (MODIFIERS.has(other)) continue;
            this.pressedKeys.delete(other);
            this.ups.add(other);
          }
        }
      }
    }
    this.cached = null;
  }

  /** True while `key` (any accepted spelling) is held. */
  isDown(key: string): boolean {
    return this.pressedKeys.has(normalizeKey(key));
  }

  /** True on the frame `key` went down. */
  wentDown(key: string): boolean {
    return this.downs.has(normalizeKey(key));
  }

  /** True on the frame `key` went up. */
  wentUp(key: string): boolean {
    return this.ups.has(normalizeKey(key));
  }

  /** Snapshot for the current frame (sets are copies). */
  snapshot(): KeyboardSnapshot {
    this.cached ??= {
      pressed: new Set(this.pressedKeys),
      downThisFrame: new Set(this.downs),
      upThisFrame: new Set(this.ups),
      text: this.typed,
    };
    return this.cached;
  }

  /** Release every held key (window blur, prototype restart). */
  releaseAll(): void {
    for (const key of this.pressedKeys) this.ups.add(key);
    this.pressedKeys.clear();
    this.cached = null;
  }

  /** Clear one-frame transitions and typed text. */
  endFrame(): void {
    this.downs.clear();
    this.ups.clear();
    this.typed = "";
    this.cached = null;
  }
}
