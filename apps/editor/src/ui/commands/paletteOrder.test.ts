import { describe, expect, it } from "vitest";
import type { Command } from "./commandRegistry.ts";
import { orderPaletteItems } from "./paletteOrder.ts";

const cmd = (id: string, category?: string): Command => ({ id, title: id, ...(category ? { category } : {}), run: () => undefined });

describe("orderPaletteItems", () => {
  it("orders menu categories, then panels, then others, keeping registration order inside a category", () => {
    const available = [
      cmd("canvas.zoom", "Canvas"),
      cmd("viewer.frame", "Viewer"),
      cmd("view.layers", "View"),
      cmd("misc.thing", "Gallery"),
      cmd("plain"),
      cmd("help.learn", "Help"),
      cmd("file.save", "File"),
      cmd("file.new", "File"),
      cmd("proto.restart", "Prototype"),
      cmd("edit.undo", "Edit"),
      cmd("layer.group", "Layer"),
      cmd("patchEditor.tidy", "Patches"),
    ];
    const items = orderPaletteItems(available, []);
    expect(items.map((i) => i.group)).toEqual(["File", "File", "Edit", "View", "Layer", "Prototype", "Help", "Viewer", "Canvas", "Patches", "Gallery", "General"]);
    expect(items.slice(0, 2).map((i) => i.command.id)).toEqual(["file.save", "file.new"]);
  });

  it("puts up to five recent commands first, once", () => {
    const available = ["a", "b", "c", "d", "e", "f"].map((id) => cmd(id, "Edit"));
    const items = orderPaletteItems(available, ["f", "missing", "a", "b", "c", "d", "e"]);
    expect(items.filter((i) => i.group === "Recent").map((i) => i.command.id)).toEqual(["f", "a", "b", "c", "d"]);
    expect(items.filter((i) => i.group === "Edit").map((i) => i.command.id)).toEqual(["e"]);
  });
});
