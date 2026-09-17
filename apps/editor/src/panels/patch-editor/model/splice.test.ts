import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gestureEntries } from "../../../app/KeyboardShortcutsDialog.tsx";
import { isSpliceDrag } from "./splice.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const patch = { type: "patch" };

describe("isSpliceDrag", () => {
  it("splices only with ⌘ or Ctrl held and one patch dragged", () => {
    expect(isSpliceDrag({ metaKey: false, ctrlKey: false }, [patch])).toBe(false);
    expect(isSpliceDrag({ metaKey: true, ctrlKey: false }, [patch])).toBe(true);
    expect(isSpliceDrag({ metaKey: false, ctrlKey: true }, [patch])).toBe(true);
    expect(isSpliceDrag({ metaKey: true, ctrlKey: false }, [patch, patch])).toBe(false);
    expect(isSpliceDrag({ metaKey: true, ctrlKey: false }, [{ type: "layer" }])).toBe(false);
  });

  it("matches the shortcuts cheat sheet and the docs", () => {
    const entry = (platform: "mac" | "windows") => gestureEntries(platform).find((e) => e.title === "Splice a patch into a cable")!.keys;
    expect(entry("mac")).toMatch(/^⌘-drag/);
    expect(entry("windows")).toMatch(/^Ctrl-drag/);

    const guide = read("../../../../../../docs/guides/10-coming-from-origami.md");
    const row = guide.split("\n").find((line) => line.startsWith("| Splice a patch into a cable |"))!;
    const [, origami, sonobe] = row.split("|").map((cell) => cell.trim()).filter(Boolean);
    expect(origami).toMatch(/^⌘-drag/);
    // The migration guide's Sonobe column is either "Same" (as Origami) or spells out the ⌘-drag.
    expect(sonobe).toMatch(/^(Same\b|⌘-drag)/);

    const architecture = read("../../../../../../ARCHITECTURE.md");
    const splice = architecture.split("\n").find((line) => /splice it in/.test(line))!;
    expect(splice).toMatch(/⌘-drag \(Ctrl-drag on Windows and Linux\)/);
  });
});
