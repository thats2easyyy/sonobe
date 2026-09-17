/**
 * Keyboard shortcuts: platform-aware parsing ("Mod" is ⌘ on macOS and Ctrl elsewhere), display
 * formatting, and a manager that routes keydown events to bindings by scope.
 *
 * Scopes come from the DOM: ancestors of the event target with `data-shortcut-scope` (innermost
 * first). When the target has none (focus on the body), the manager falls back to context scopes,
 * such as the panel under the pointer. "global" is always last. While a modal scope is pushed
 * (the command palette, a dialog), only that scope's bindings fire. Bindings are suppressed while
 * typing in an editable element unless they set `allowInInput`.
 */

export type Platform = "mac" | "windows" | "linux";

export type ShortcutScope =
  | "global"
  | "patchEditor"
  | "canvas"
  | "viewer"
  | "layers"
  | "inspector"
  | (string & {});

export const SCOPE_ATTRIBUTE = "data-shortcut-scope";

export interface NavigatorLike {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/** Anything with a Node-style platform string (window.sonobeHost in the desktop app). */
export interface HostPlatformLike {
  readonly platform?: string;
}

/** A platform name from Node ("darwin", "win32", "linux") or a browser ("macOS", "MacIntel", "Windows", "Linux x86_64"). */
export function platformFromName(name: string | null | undefined): Platform | undefined {
  const text = (name ?? "").trim().toLowerCase();
  if (!text) return undefined;
  if (text === "darwin" || /mac|iphone|ipad|ipod/.test(text)) return "mac";
  if (text === "win32" || /^win|windows/.test(text)) return "windows";
  if (/linux|cros|x11|bsd|android/.test(text)) return "linux";
  return undefined;
}

function globalHost(): HostPlatformLike | undefined {
  try {
    return (globalThis as { sonobeHost?: HostPlatformLike }).sonobeHost;
  } catch {
    return undefined;
  }
}

/**
 * Detect the platform: the desktop host's platform first (it's the real OS even when the web view
 * reports something else), then navigator.userAgentData, navigator.platform, and the user agent.
 * Passing `nav` without `host` ignores window.sonobeHost.
 */
export function detectPlatform(nav?: NavigatorLike, host?: HostPlatformLike | null): Platform {
  const desktop = host !== undefined ? host : nav ? null : globalHost();
  const fromHost = platformFromName(desktop?.platform);
  if (fromHost) return fromHost;
  const source = nav ?? (typeof navigator === "undefined" ? undefined : (navigator as NavigatorLike));
  return platformFromName(source?.userAgentData?.platform) ?? platformFromName(source?.platform) ?? platformFromName(source?.userAgent) ?? "linux";
}

/** The Node-style platform name ("darwin" | "win32" | "linux"), for paths and shell commands. */
export function detectHostPlatform(nav?: NavigatorLike, host?: HostPlatformLike | null): "darwin" | "win32" | "linux" {
  const platform = detectPlatform(nav, host);
  return platform === "mac" ? "darwin" : platform === "windows" ? "win32" : "linux";
}

export interface KeyChord {
  key: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  return: "enter",
  del: "delete",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  " ": "space",
  spacebar: "space",
  plus: "+",
  minus: "-",
  comma: ",",
  period: ".",
  slash: "/",
};

export function normalizeKeyName(key: string): string {
  const lower = key.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

/**
 * Parse "Mod+Shift+K", "Alt+Enter", "Ctrl+T", "?", "Mod++". Modifier names are case-insensitive:
 * Mod, Cmd/Command/Meta/⌘, Ctrl/Control/⌃, Alt/Option/Opt/⌥, Shift/⇧.
 */
export function parseShortcut(spec: string, platform: Platform): KeyChord {
  const tokens = spec.split("+");
  let key = tokens.pop() ?? "";
  if (key === "" && spec.endsWith("+")) {
    key = "+";
    while (tokens.length > 0 && tokens[tokens.length - 1] === "") tokens.pop();
  }
  if (key === "") throw new Error(`Shortcut "${spec}" has no key`);
  const chord: KeyChord = { key: normalizeKeyName(key), meta: false, ctrl: false, alt: false, shift: false };
  for (const token of tokens) {
    switch (token.trim().toLowerCase()) {
      case "mod":
        if (platform === "mac") chord.meta = true;
        else chord.ctrl = true;
        break;
      case "cmd":
      case "command":
      case "meta":
      case "⌘":
        chord.meta = true;
        break;
      case "ctrl":
      case "control":
      case "⌃":
        chord.ctrl = true;
        break;
      case "alt":
      case "option":
      case "opt":
      case "⌥":
        chord.alt = true;
        break;
      case "shift":
      case "⇧":
        chord.shift = true;
        break;
      default:
        throw new Error(`Unknown modifier "${token}" in shortcut "${spec}"`);
    }
  }
  return chord;
}

type KeyEventLike = Pick<KeyboardEvent, "key" | "code" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey">;

/**
 * The key an event represents. Uses `key` (layout-aware) except when Alt or Shift turned a
 * letter or digit into another character (⌥A → "å", ⇧1 → "!"), where it falls back to `code`.
 */
export function keyFromEvent(event: Pick<KeyboardEvent, "key" | "code" | "altKey" | "shiftKey">): string {
  if ((event.altKey || event.shiftKey || event.key === "Dead") && event.code) {
    const letter = /^Key([A-Z])$/.exec(event.code);
    if (letter && (event.altKey || event.key === "Dead")) return letter[1]!.toLowerCase();
    const digit = /^Digit(\d)$/.exec(event.code);
    if (digit) return digit[1]!;
  }
  return normalizeKeyName(event.key);
}

const isSymbolKey = (key: string) => key.length === 1 && !/[a-z0-9]/.test(key);

/** Whether a keyboard event matches a chord. Shift is ignored for symbol keys like "?" and "+". */
export function matchesChord(event: KeyEventLike, chord: KeyChord): boolean {
  if (event.metaKey !== chord.meta || event.ctrlKey !== chord.ctrl || event.altKey !== chord.alt) return false;
  const symbol = isSymbolKey(chord.key);
  // Symbols are compared by the produced character, which already reflects Shift.
  const key = symbol ? normalizeKeyName(event.key) : keyFromEvent(event);
  if (key !== chord.key) return false;
  if (!symbol && event.shiftKey !== chord.shift) return false;
  return true;
}

const MAC_KEY_LABELS: Record<string, string> = {
  enter: "⏎",
  escape: "Esc",
  backspace: "⌫",
  delete: "⌦",
  tab: "⇥",
  space: "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  pageup: "PgUp",
  pagedown: "PgDn",
};

const OTHER_KEY_LABELS: Record<string, string> = {
  enter: "Enter",
  escape: "Esc",
  backspace: "Backspace",
  delete: "Del",
  tab: "Tab",
  space: "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  pageup: "PgUp",
  pagedown: "PgDn",
};

function keyLabel(key: string, platform: Platform): string {
  const labels = platform === "mac" ? MAC_KEY_LABELS : OTHER_KEY_LABELS;
  const known = labels[key];
  if (known) return known;
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Display parts for a shortcut, in platform order. macOS: ["⇧", "⌘", "K"] (⌃⌥⇧⌘ order);
 * elsewhere: ["Ctrl", "Shift", "K"].
 */
export function formatShortcut(spec: string, platform: Platform): string[] {
  const chord = parseShortcut(spec, platform);
  const parts: string[] = [];
  if (platform === "mac") {
    if (chord.ctrl) parts.push("⌃");
    if (chord.alt) parts.push("⌥");
    if (chord.shift) parts.push("⇧");
    if (chord.meta) parts.push("⌘");
  } else {
    if (chord.ctrl) parts.push("Ctrl");
    if (chord.alt) parts.push("Alt");
    if (chord.shift) parts.push("Shift");
    if (chord.meta) parts.push(platform === "windows" ? "Win" : "Super");
  }
  parts.push(keyLabel(chord.key, platform));
  return parts;
}

/** Single-string label: "⇧⌘K" on macOS, "Ctrl+Shift+K" elsewhere. */
export function formatShortcutLabel(spec: string, platform: Platform): string {
  return formatShortcut(spec, platform).join(platform === "mac" ? "" : "+");
}

const NON_TEXT_INPUT_TYPES = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

interface ElementLike {
  tagName: string;
  getAttribute(name: string): string | null;
  parentElement: ElementLike | null;
  closest?(selector: string): unknown;
}

function asElement(target: EventTarget | null | undefined): ElementLike | null {
  if (!target || typeof (target as Partial<ElementLike>).getAttribute !== "function") return null;
  return target as unknown as ElementLike;
}

/** True for text inputs, textareas, selects, and contenteditable regions. */
export function isEditableTarget(target: EventTarget | null | undefined): boolean {
  const el = asElement(target);
  if (!el) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has((el.getAttribute("type") ?? "text").toLowerCase());
  return Boolean(el.closest?.('[contenteditable]:not([contenteditable="false"])'));
}

export interface ShortcutBinding {
  /** One spec or several alternatives. */
  shortcut: string | readonly string[];
  /** Return false to decline and let lower-priority bindings try. */
  handler: (event: KeyboardEvent) => boolean | void;
  scope?: ShortcutScope;
  /** Extra enablement check evaluated at dispatch time. */
  when?: () => boolean;
  /** Fire even while typing in an input (e.g. ⌘K, ⌘S). */
  allowInInput?: boolean;
  /** Fire on auto-repeat while the key is held (e.g. nudging). */
  allowRepeat?: boolean;
  id?: string;
}

interface RegisteredBinding {
  binding: ShortcutBinding;
  chords: KeyChord[];
  order: number;
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn", "OS"]);

export class KeyboardShortcutManager {
  readonly platform: Platform;
  #bindings: RegisteredBinding[] = [];
  #modalScopes: ShortcutScope[] = [];
  #contextScopes: ShortcutScope[] = [];
  #order = 0;

  constructor(options: { platform?: Platform } = {}) {
    this.platform = options.platform ?? detectPlatform();
  }

  /** Register a binding; returns a function that removes it. Later bindings win within a scope. */
  bind(binding: ShortcutBinding): () => void {
    const specs: readonly string[] = typeof binding.shortcut === "string" ? [binding.shortcut] : binding.shortcut;
    const entry: RegisteredBinding = {
      binding,
      chords: specs.map((spec) => parseShortcut(spec, this.platform)),
      order: this.#order++,
    };
    this.#bindings.push(entry);
    return () => {
      const index = this.#bindings.indexOf(entry);
      if (index >= 0) this.#bindings.splice(index, 1);
    };
  }

  /** Restrict dispatch to one scope until the returned function is called. */
  pushModalScope(scope: ShortcutScope): () => void {
    this.#modalScopes.push(scope);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const index = this.#modalScopes.lastIndexOf(scope);
      if (index >= 0) this.#modalScopes.splice(index, 1);
    };
  }

  /** Scopes used when the event target has no scoped ancestor (e.g. the hovered panel). */
  setContextScopes(scopes: readonly ShortcutScope[]): void {
    this.#contextScopes = [...scopes];
  }

  get contextScopes(): readonly ShortcutScope[] {
    return this.#contextScopes;
  }

  /** Active scopes for an event target, most specific first, always ending in "global". */
  resolveScopes(target: EventTarget | null | undefined): ShortcutScope[] {
    const modal = this.#modalScopes[this.#modalScopes.length - 1];
    if (modal !== undefined) return [modal];
    const scopes: ShortcutScope[] = [];
    for (let el = asElement(target); el; el = el.parentElement) {
      const scope = el.getAttribute(SCOPE_ATTRIBUTE);
      if (scope && !scopes.includes(scope)) scopes.push(scope);
    }
    if (scopes.length === 0) {
      for (const scope of this.#contextScopes) if (!scopes.includes(scope)) scopes.push(scope);
    }
    if (!scopes.includes("global")) scopes.push("global");
    return scopes;
  }

  /** Route a keydown event. Returns true when a binding handled it (and prevented default). */
  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.isComposing || MODIFIER_KEYS.has(event.key)) return false;
    const editable = isEditableTarget(event.target);
    for (const scope of this.resolveScopes(event.target)) {
      const candidates = this.#bindings
        .filter((entry) => (entry.binding.scope ?? "global") === scope)
        .sort((a, b) => b.order - a.order);
      for (const { binding, chords } of candidates) {
        if (!chords.some((chord) => matchesChord(event, chord))) continue;
        if (editable && !binding.allowInInput) continue;
        if (binding.when && !binding.when()) continue;
        if (event.repeat && !binding.allowRepeat) {
          event.preventDefault();
          return true;
        }
        if (binding.handler(event) === false) continue;
        event.preventDefault();
        return true;
      }
    }
    return false;
  }

  /** Listen for keydown on a target (defaults to window); returns a detach function. */
  attach(target?: Pick<EventTarget, "addEventListener" | "removeEventListener">): () => void {
    const host = target ?? window;
    const listener = (event: Event) => {
      this.handleKeyDown(event as KeyboardEvent);
    };
    host.addEventListener("keydown", listener);
    return () => host.removeEventListener("keydown", listener);
  }

  /** All registered bindings, in registration order. */
  bindings(): readonly ShortcutBinding[] {
    return this.#bindings.map((entry) => entry.binding);
  }
}
