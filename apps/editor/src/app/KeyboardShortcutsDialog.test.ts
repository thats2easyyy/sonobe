import { describe, expect, it } from "vitest";
import { getRegistry } from "../state/registry.ts";
import type { Command } from "../ui/commands/commandRegistry.ts";
import { filterShortcutSections, GESTURES_SECTION, gestureEntries, PATCH_KEYS_SECTION, shortcutSections } from "./KeyboardShortcutsDialog.tsx";

const run = () => undefined;

const commands: Command[] = [
  { id: "view.toggleLayers", title: "Show or Hide Layers", category: "View", shortcut: "Mod+1", run },
  { id: "file.save", title: "Save", category: "File", shortcut: "Mod+S", run },
  { id: "patchEditor.alignTop", title: "Align Top Edges", category: "Patches", shortcut: "Mod+Shift+[", run },
  { id: "app.commandPalette", title: "Show Command Palette", category: "General", shortcut: ["Mod+K", "Mod+Shift+P"], hidden: true, run },
  { id: "patch.alignLeft", title: "patch.alignLeft", hidden: true, run },
  { id: "help.about", title: "About Sonobe", category: "Help", run },
];

describe("keyboard shortcuts cheat sheet", () => {
  it("lists commands with shortcuts in menu order, then single-key inserts and gestures", () => {
    const sections = shortcutSections(commands, getRegistry(), "mac");
    expect(sections.map((s) => s.title)).toEqual(["File", "View", "Patches", "General", PATCH_KEYS_SECTION, GESTURES_SECTION]);
    expect(sections.find((s) => s.title === "General")!.entries).toEqual([{ title: "Command Palette", shortcut: ["Mod+K", "Mod+Shift+P"] }]);
    const keys = sections.find((s) => s.title === PATCH_KEYS_SECTION)!.entries;
    expect(keys).toContainEqual({ title: "Insert Variable Broadcaster", shortcut: "W" });
    expect(keys).toContainEqual({ title: "Insert Pop Animation", shortcut: "A" });
    expect(sections.at(-1)!.entries.map((e) => e.title)).toContain("Cut cables");
  });

  it("searches titles and gesture words, keeping a matching section whole", () => {
    const sections = shortcutSections(commands, getRegistry(), "windows");
    expect(filterShortcutSections(sections, "align").map((s) => [s.title, s.entries.map((e) => e.title)])).toEqual([["Patches", ["Align Top Edges"]]]);
    expect(filterShortcutSections(sections, "right-drag")[0]!.entries).toEqual([{ title: "Cut cables", keys: "Ctrl + right-drag across them" }]);
    expect(filterShortcutSections(sections, "view")[0]!.title).toBe("View");
    expect(filterShortcutSections(sections, "zzz")).toEqual([]);
  });

  it("names modifiers the platform's way", () => {
    expect(gestureEntries("mac").find((e) => e.title === "Duplicate patches or layers")!.keys).toBe("⌥-drag them");
    expect(gestureEntries("linux").find((e) => e.title === "Duplicate patches or layers")!.keys).toBe("Alt-drag them");
  });
});
