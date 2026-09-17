import { describe, expect, it } from "vitest";
import { CommandRegistry } from "../ui/commands/commandRegistry.ts";
import { commandMenuEntries } from "./EditorApp.tsx";

describe("commandMenuEntries", () => {
  it("builds the title menu from registered file commands", () => {
    const registry = new CommandRegistry();
    let saved = 0;
    registry.register([
      { id: "file.new", title: "New Prototype", shortcut: "Mod+N", run: () => undefined },
      { id: "file.open", title: "Open…", shortcut: ["Mod+O"], run: () => undefined },
      { id: "file.save", title: "Save", shortcut: "Mod+S", run: () => void saved++ },
      { id: "file.saveAs", title: "Save As…", when: () => false, run: () => undefined },
      { id: "file.reveal", title: "Show in Finder", when: () => false, run: () => undefined },
    ]);
    const entries = commandMenuEntries(registry);
    expect(entries.map((e) => (e.type === "separator" ? "---" : "label" in e ? e.label : ""))).toEqual(["New Prototype", "Open…", "---", "Save", "Save As…"]);
    const open = entries[1]!;
    expect(open).toMatchObject({ shortcut: "Mod+O", disabled: false });
    expect(entries[4]).toMatchObject({ disabled: true });
    const save = entries[3] as { onSelect: () => void };
    save.onSelect();
    expect(saved).toBe(1);
  });

  it("skips missing commands and dangling separators", () => {
    const registry = new CommandRegistry();
    registry.register({ id: "file.new", title: "New Prototype", run: () => undefined });
    expect(commandMenuEntries(registry).map((e) => e.type ?? "item")).toEqual(["item"]);
  });
});
