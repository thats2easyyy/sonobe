// @vitest-environment happy-dom
import { createPatchRegistry } from "@sonobe/patches";
import { createRegistry } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { chordFromEvent, chordOf, DEFAULT_SINGLE_KEYS, resolveSingleKeyInsert, singleKeyInserts } from "./singleKey.ts";

const registry = createPatchRegistry();
const inserts = singleKeyInserts(registry);
const key = (k: string, mods: Partial<{ shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }> = {}) => ({ key: k, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, ...mods });

describe("chordOf", () => {
  it("normalizes letters, shifted letters, and symbols", () => {
    expect(chordOf("A")).toBe("a");
    expect(chordOf("Shift+R")).toBe("shift+r");
    expect(chordOf("+")).toBe("+");
    expect(chordOf("Shift++")).toBe("+");
    expect(chordOf(">")).toBe(">");
  });

  it("refuses chords with other modifiers", () => {
    expect(chordOf("Mod+A")).toBeUndefined();
    expect(chordOf("Alt+Enter")).toBeUndefined();
  });
});

describe("single-key inserts", () => {
  it("maps every standard key to its patch type", () => {
    const expected: [ReturnType<typeof key>, string][] = [
      [key("i"), "interaction"],
      [key("s"), "switch"],
      [key("a"), "popAnimation"],
      [key("c"), "classicAnimation"],
      [key("t"), "transition"],
      [key("d"), "delay"],
      [key("o"), "optionPicker"],
      [key("x"), "splitter"],
      [key("w"), "variableBroadcaster"],
      [key("W", { shiftKey: true }), "variableReceiver"],
      [key("u"), "pulse"],
      [key("+", { shiftKey: true }), "add"],
      [key("-"), "subtract"],
      [key("*", { shiftKey: true }), "multiply"],
      [key("/"), "divide"],
      [key("e"), "equals"],
      [key(">", { shiftKey: true }), "greaterThan"],
      [key("<", { shiftKey: true }), "lessThan"],
      [key("A", { shiftKey: true }), "and"],
      [key("O", { shiftKey: true }), "or"],
      [key("N", { shiftKey: true }), "not"],
      [key("r"), "reverseProgress"],
      [key("R", { shiftKey: true }), "progress"],
    ];
    for (const [event, type] of expected) expect(resolveSingleKeyInsert(inserts, event), `${event.shiftKey ? "⇧" : ""}${event.key}`).toBe(type);
  });

  it("ignores chords with Command, Control, or Option, and unmapped keys", () => {
    expect(chordFromEvent(key("a", { metaKey: true }))).toBeUndefined();
    expect(resolveSingleKeyInsert(inserts, key("a", { ctrlKey: true }))).toBeUndefined();
    expect(resolveSingleKeyInsert(inserts, key("a", { altKey: true }))).toBeUndefined();
    expect(resolveSingleKeyInsert(inserts, key("q"))).toBeUndefined();
    expect(resolveSingleKeyInsert(inserts, key("Enter"))).toBeUndefined();
    expect(resolveSingleKeyInsert(inserts, key(" "))).toBeUndefined();
  });

  it("treats Caps Lock letters like lowercase", () => {
    expect(resolveSingleKeyInsert(inserts, key("S"))).toBe("switch");
  });

  it("only offers types that exist", () => {
    const tiny = createRegistry([
      { type: "switch", name: "Switch", category: "state", summary: "Flips.", inputs: [], outputs: [] },
      { type: "counter", name: "Counter", category: "state", summary: "Counts.", inputs: [], outputs: [], shortcut: "K" },
    ]);
    const map = singleKeyInserts(tiny);
    expect(map.map((i) => i.type).sort()).toEqual(["counter", "switch"]);
    expect(resolveSingleKeyInsert(map, key("a"))).toBeUndefined();
    expect(resolveSingleKeyInsert(map, key("k"))).toBe("counter");
    expect(Object.values(DEFAULT_SINGLE_KEYS).every((type) => registry.patches.has(type))).toBe(true);
  });
});
