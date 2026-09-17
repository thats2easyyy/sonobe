/** Keyboard: true while a key, or every key in a `+` combination, is held. */

import { normalizeKey } from "@sonobe/engine";
import { definePatch, toText } from "../infra/index.ts";

const MAX_CACHED_KEYS = 256;
const parsed = new Map<string, readonly string[]>();

/**
 * Canonical key names for a Key text: `"Shift+Up"` → `["Shift", "ArrowUp"]`, `" "` → `["Space"]`,
 * `"+"` and `"Shift++"` watch the plus key, and blank text watches nothing.
 */
export function parseKeyCombination(raw: string): readonly string[] {
  const cached = parsed.get(raw);
  if (cached) return cached;
  let parts: string[];
  if (raw === " ") parts = [" "];
  else if (raw.trim() === "") parts = [];
  else {
    parts = raw.split("+").map((p) => p.trim());
    if (parts.includes("")) parts = [...parts.filter((p) => p !== ""), "+"];
  }
  const names = parts.map(normalizeKey);
  if (parsed.size >= MAX_CACHED_KEYS) parsed.clear();
  parsed.set(raw, names);
  return names;
}

export const keyboard = definePatch("keyboard", {
  evaluate(ctx) {
    const names = parseKeyCombination(toText(ctx.input("key")));
    const enabled = ctx.input<boolean>("enabled") === true;
    if (!enabled || names.length === 0) {
      ctx.output("down", false);
      return;
    }
    const pressed = ctx.services.keyboard().pressed;
    ctx.output("down", names.every((key) => pressed.has(key)));
  },
  mutedBehavior: "zero",
});
