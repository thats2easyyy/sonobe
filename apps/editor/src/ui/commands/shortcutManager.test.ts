// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KeyboardShortcutManager,
  detectPlatform,
  formatShortcut,
  formatShortcutLabel,
  isEditableTarget,
  keyFromEvent,
  matchesChord,
  parseShortcut,
} from "./shortcutManager.ts";

function key(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("detectPlatform", () => {
  it("reads userAgentData, platform, or userAgent", () => {
    expect(detectPlatform({ userAgentData: { platform: "macOS" } })).toBe("mac");
    expect(detectPlatform({ platform: "Win32" })).toBe("windows");
    expect(detectPlatform({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe("linux");
  });
});

describe("parseShortcut / formatShortcut", () => {
  it("maps Mod to ⌘ on mac and Ctrl elsewhere", () => {
    expect(parseShortcut("Mod+K", "mac")).toEqual({ key: "k", meta: true, ctrl: false, alt: false, shift: false });
    expect(parseShortcut("Mod+K", "windows")).toEqual({ key: "k", meta: false, ctrl: true, alt: false, shift: false });
  });

  it("handles aliases, the plus key, and rejects unknown modifiers", () => {
    expect(parseShortcut("Option+Return", "mac")).toMatchObject({ key: "enter", alt: true });
    expect(parseShortcut("Mod++", "mac")).toMatchObject({ key: "+", meta: true });
    expect(parseShortcut("+", "mac")).toMatchObject({ key: "+" });
    expect(() => parseShortcut("Hyper+K", "mac")).toThrow(/Unknown modifier/);
  });

  it("formats in platform order", () => {
    expect(formatShortcut("Shift+Mod+K", "mac")).toEqual(["⇧", "⌘", "K"]);
    expect(formatShortcut("Mod+Alt+Ctrl+Enter", "mac")).toEqual(["⌃", "⌥", "⌘", "⏎"]);
    expect(formatShortcutLabel("Mod+Shift+K", "mac")).toBe("⇧⌘K");
    expect(formatShortcutLabel("Mod+Shift+K", "windows")).toBe("Ctrl+Shift+K");
    expect(formatShortcutLabel("F2", "linux")).toBe("F2");
  });
});

describe("matchesChord", () => {
  const base = { code: "", altKey: false, shiftKey: false, metaKey: false, ctrlKey: false };

  it("compares modifiers exactly for letters", () => {
    const chord = parseShortcut("Mod+Shift+Z", "mac");
    expect(matchesChord({ ...base, key: "z", metaKey: true, shiftKey: true }, chord)).toBe(true);
    expect(matchesChord({ ...base, key: "z", metaKey: true }, chord)).toBe(false);
    expect(matchesChord({ ...base, key: "z", metaKey: true, shiftKey: true, altKey: true }, chord)).toBe(false);
  });

  it("uses the physical key when Option produces a special character", () => {
    expect(keyFromEvent({ key: "å", code: "KeyA", altKey: true, shiftKey: false })).toBe("a");
    expect(matchesChord({ ...base, key: "å", code: "KeyA", altKey: true }, parseShortcut("Alt+A", "mac"))).toBe(true);
    expect(matchesChord({ ...base, key: "!", code: "Digit1", shiftKey: true }, parseShortcut("Shift+1", "mac"))).toBe(true);
  });

  it("ignores Shift for symbol keys", () => {
    expect(matchesChord({ ...base, key: "?", code: "Slash", shiftKey: true }, parseShortcut("?", "mac"))).toBe(true);
    expect(matchesChord({ ...base, key: "+", code: "Equal", shiftKey: true }, parseShortcut("+", "mac"))).toBe(true);
    expect(matchesChord({ ...base, key: "+", code: "Equal", shiftKey: true, metaKey: true }, parseShortcut("Mod++", "mac"))).toBe(true);
  });

  it("tells ⌘[ from ⇧⌘[ (and ⌘] from ⇧⌘])", () => {
    const left = parseShortcut("Mod+[", "mac");
    const top = parseShortcut("Mod+Shift+[", "mac");
    const right = parseShortcut("Mod+]", "mac");
    const bottom = parseShortcut("Mod+Shift+]", "mac");
    const cmdBracket = { ...base, key: "[", code: "BracketLeft", metaKey: true };
    const shiftCmdBracket = { ...base, key: "{", code: "BracketLeft", metaKey: true, shiftKey: true };
    expect(matchesChord(cmdBracket, left)).toBe(true);
    expect(matchesChord(cmdBracket, top)).toBe(false);
    expect(matchesChord(shiftCmdBracket, top)).toBe(true);
    expect(matchesChord(shiftCmdBracket, left)).toBe(false);
    // Some platforms report the unshifted character with Shift held.
    expect(matchesChord({ ...cmdBracket, shiftKey: true }, top)).toBe(true);
    expect(matchesChord({ ...cmdBracket, shiftKey: true }, left)).toBe(false);

    const cmdClose = { ...base, key: "]", code: "BracketRight", metaKey: true };
    const shiftCmdClose = { ...base, key: "}", code: "BracketRight", metaKey: true, shiftKey: true };
    expect(matchesChord(cmdClose, right)).toBe(true);
    expect(matchesChord(cmdClose, bottom)).toBe(false);
    expect(matchesChord(shiftCmdClose, bottom)).toBe(true);
    expect(matchesChord(shiftCmdClose, right)).toBe(false);
  });

  it("matches Option with a symbol by its physical key (⌥⌘/ types ÷)", () => {
    expect(matchesChord({ ...base, key: "÷", code: "Slash", metaKey: true, altKey: true }, parseShortcut("Mod+Alt+/", "mac"))).toBe(true);
    expect(matchesChord({ ...base, key: "÷", code: "Slash", metaKey: true }, parseShortcut("Mod+/", "mac"))).toBe(false);
  });
});

describe("isEditableTarget", () => {
  it("recognizes text entry elements only", () => {
    const text = document.createElement("input");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    editor.appendChild(child);
    expect(isEditableTarget(text)).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(child)).toBe(true);
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
  });
});

describe("KeyboardShortcutManager", () => {
  let manager: KeyboardShortcutManager;
  let detach: () => void;
  let patchEditor: HTMLDivElement;
  let canvas: HTMLDivElement;
  let nodeInPatchEditor: HTMLButtonElement;
  let input: HTMLInputElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    manager = new KeyboardShortcutManager({ platform: "mac" });
    detach = manager.attach(document);
    patchEditor = document.createElement("div");
    patchEditor.setAttribute("data-shortcut-scope", "patchEditor");
    nodeInPatchEditor = document.createElement("button");
    patchEditor.appendChild(nodeInPatchEditor);
    canvas = document.createElement("div");
    canvas.setAttribute("data-shortcut-scope", "canvas");
    input = document.createElement("input");
    canvas.appendChild(input);
    document.body.append(patchEditor, canvas);
  });

  afterEach(() => detach());

  it("fires global bindings from anywhere and prevents default", () => {
    const handler = vi.fn();
    manager.bind({ shortcut: "Mod+K", handler });
    const event = key(document.body, { key: "k", metaKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("only fires scoped bindings inside their scope", () => {
    const insertSwitch = vi.fn();
    manager.bind({ shortcut: "S", scope: "patchEditor", handler: insertSwitch });
    key(canvas, { key: "s" });
    expect(insertSwitch).not.toHaveBeenCalled();
    key(nodeInPatchEditor, { key: "s" });
    expect(insertSwitch).toHaveBeenCalledTimes(1);
  });

  it("lets the innermost scope win over global for the same chord", () => {
    const global = vi.fn();
    const scoped = vi.fn();
    manager.bind({ shortcut: "Mod+A", handler: global });
    manager.bind({ shortcut: "Mod+A", scope: "patchEditor", handler: scoped });
    key(nodeInPatchEditor, { key: "a", metaKey: true });
    expect(scoped).toHaveBeenCalledTimes(1);
    expect(global).not.toHaveBeenCalled();
    key(document.body, { key: "a", metaKey: true });
    expect(global).toHaveBeenCalledTimes(1);
  });

  it("suppresses bindings while typing unless allowInInput", () => {
    const tidy = vi.fn();
    const palette = vi.fn();
    manager.bind({ shortcut: "T", scope: "canvas", handler: tidy });
    manager.bind({ shortcut: "Mod+K", handler: palette, allowInInput: true });
    const typed = key(input, { key: "t" });
    expect(tidy).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);
    key(input, { key: "k", metaKey: true });
    expect(palette).toHaveBeenCalledTimes(1);
  });

  it("falls back to context scopes when focus is outside any scope", () => {
    const zoom = vi.fn();
    manager.bind({ shortcut: "Z", scope: "viewer", handler: zoom });
    key(document.body, { key: "z" });
    expect(zoom).not.toHaveBeenCalled();
    manager.setContextScopes(["viewer"]);
    key(document.body, { key: "z" });
    expect(zoom).toHaveBeenCalledTimes(1);
    key(nodeInPatchEditor, { key: "z" });
    expect(zoom).toHaveBeenCalledTimes(1);
  });

  it("restricts dispatch to a pushed modal scope", () => {
    const global = vi.fn();
    const modal = vi.fn();
    manager.bind({ shortcut: "Escape", handler: global });
    manager.bind({ shortcut: "Escape", scope: "palette", handler: modal, allowInInput: true });
    const release = manager.pushModalScope("palette");
    key(document.body, { key: "Escape" });
    expect(modal).toHaveBeenCalledTimes(1);
    expect(global).not.toHaveBeenCalled();
    release();
    release();
    key(document.body, { key: "Escape" });
    expect(global).toHaveBeenCalledTimes(1);
  });

  it("respects when(), declines with false, repeats, and unbinding", () => {
    let enabled = false;
    const guarded = vi.fn();
    const fallback = vi.fn();
    const decline = vi.fn(() => false as const);
    manager.bind({ shortcut: "Mod+R", handler: fallback });
    manager.bind({ shortcut: "Mod+R", handler: guarded, when: () => enabled });
    key(document.body, { key: "r", metaKey: true });
    expect(guarded).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);

    enabled = true;
    key(document.body, { key: "r", metaKey: true, repeat: true });
    expect(guarded).not.toHaveBeenCalled();

    const unbindDecline = manager.bind({ shortcut: "Mod+R", handler: decline });
    key(document.body, { key: "r", metaKey: true });
    expect(decline).toHaveBeenCalledTimes(1);
    expect(guarded).toHaveBeenCalledTimes(1);

    unbindDecline();
    key(document.body, { key: "r", metaKey: true });
    expect(decline).toHaveBeenCalledTimes(1);
    expect(guarded).toHaveBeenCalledTimes(2);
  });

  it("routes the four align chords to their own commands in one scope", () => {
    const fired: string[] = [];
    for (const [id, shortcut] of [
      ["alignLeft", "Mod+["],
      ["alignRight", "Mod+]"],
      ["alignTop", "Mod+Shift+["],
      ["alignBottom", "Mod+Shift+]"],
    ] as const) {
      manager.bind({ id, shortcut, scope: "patchEditor", handler: () => void fired.push(id) });
    }
    key(nodeInPatchEditor, { key: "[", code: "BracketLeft", metaKey: true });
    key(nodeInPatchEditor, { key: "]", code: "BracketRight", metaKey: true });
    key(nodeInPatchEditor, { key: "{", code: "BracketLeft", metaKey: true, shiftKey: true });
    key(nodeInPatchEditor, { key: "}", code: "BracketRight", metaKey: true, shiftKey: true });
    expect(fired).toEqual(["alignLeft", "alignRight", "alignTop", "alignBottom"]);
  });

  it("allows auto-repeat when requested", () => {
    const nudge = vi.fn();
    manager.bind({ shortcut: "ArrowRight", scope: "canvas", handler: nudge, allowRepeat: true });
    key(canvas, { key: "ArrowRight", repeat: true });
    expect(nudge).toHaveBeenCalledTimes(1);
  });
});
