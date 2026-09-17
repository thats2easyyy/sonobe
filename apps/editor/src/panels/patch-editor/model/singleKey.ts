/**
 * Single-key inserts: hover the patch editor and press a key to drop a patch at the pointer. Patch
 * specs declare their key (`shortcut`); the table below fills in the everyday set for specs that
 * don't. Only types present in the registry are offered.
 */

import type { Registry } from "@sonobe/core";

/** The standard single-key set (ARCHITECTURE §9). */
export const DEFAULT_SINGLE_KEYS: Readonly<Record<string, string>> = {
  I: "interaction",
  S: "switch",
  A: "popAnimation",
  C: "classicAnimation",
  T: "transition",
  D: "delay",
  O: "optionPicker",
  X: "splitter",
  W: "variableBroadcaster",
  "Shift+W": "variableReceiver",
  U: "pulse",
  "+": "add",
  "-": "subtract",
  "*": "multiply",
  "/": "divide",
  E: "equals",
  ">": "greaterThan",
  "<": "lessThan",
  "Shift+A": "and",
  "Shift+O": "or",
  "Shift+N": "not",
  R: "reverseProgress",
  "Shift+R": "progress",
};

export interface SingleKeyInsert {
  /** Display/registry form ("Shift+R", "+"). */
  shortcut: string;
  /** Normalized chord ("shift+r", "+"). */
  chord: string;
  type: string;
}

/** Normalize a shortcut spec into a chord; undefined when it uses Mod, Ctrl, or Alt (not a single key). */
export function chordOf(shortcut: string): string | undefined {
  const spec = shortcut.trim();
  if (spec.length === 1) return /[a-z]/i.test(spec) ? spec.toLowerCase() : spec;
  const plus = spec.endsWith("++");
  const parts = (plus ? spec.slice(0, -2) : spec).split("+").filter(Boolean);
  const key = plus ? "+" : parts.pop();
  if (!key || key.length !== 1) return undefined;
  let shift = false;
  for (const mod of parts) {
    if (/^(shift|⇧)$/i.test(mod)) shift = true;
    else return undefined;
  }
  if (!/[a-z0-9]/i.test(key)) return key;
  return `${shift ? "shift+" : ""}${key.toLowerCase()}`;
}

/** The single-key inserts for a registry: declared shortcuts first, then the defaults. */
export function singleKeyInserts(registry: Registry): SingleKeyInsert[] {
  const byChord = new Map<string, SingleKeyInsert>();
  for (const spec of registry.patches.values()) {
    if (!spec.shortcut) continue;
    const chord = chordOf(spec.shortcut);
    if (chord && !byChord.has(chord)) byChord.set(chord, { shortcut: spec.shortcut, chord, type: spec.type });
  }
  const declaredTypes = new Set([...byChord.values()].map((i) => i.type));
  for (const [shortcut, type] of Object.entries(DEFAULT_SINGLE_KEYS)) {
    const chord = chordOf(shortcut)!;
    if (byChord.has(chord) || declaredTypes.has(type) || !registry.patches.has(type)) continue;
    byChord.set(chord, { shortcut, chord, type });
  }
  return [...byChord.values()];
}

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/** The chord a key event represents, or undefined when a modifier other than Shift is held. */
export function chordFromEvent(event: KeyLike): string | undefined {
  if (event.metaKey || event.ctrlKey || event.altKey) return undefined;
  const key = event.key;
  if (!key || key.length !== 1 || key === " ") return undefined;
  if (/[a-z0-9]/i.test(key)) return `${event.shiftKey ? "shift+" : ""}${key.toLowerCase()}`;
  return key;
}

/** The patch type a key event inserts, if any. */
export function resolveSingleKeyInsert(inserts: readonly SingleKeyInsert[], event: KeyLike): string | undefined {
  const chord = chordFromEvent(event);
  return chord === undefined ? undefined : inserts.find((i) => i.chord === chord)?.type;
}
