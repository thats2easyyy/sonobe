import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveProjectToDisk } from "@sonobe/core/node";
import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, describe, expect, it } from "vitest";
import { placemarkDeck } from "../recipes/16-placemark-deck.ts";
import { tapToGrow } from "../recipes/01-tap-to-grow.ts";
import { loadDesign } from "./design.ts";
import { EXAMPLES_DIR, projectDrift, writeAssetFiles } from "./disk.ts";
import { comment, connect, layerRef, rect } from "./kit.ts";
import { buildRecipe, buildRecipeDocument, RecipeBuildError, type Recipe } from "./recipe.ts";

const registry = createPatchRegistry();
const temps: string[] = [];
const temp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sonobe-recipe-"));
  temps.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("buildRecipe", () => {
  it("builds a plain recipe the same way buildRecipeDocument does", async () => {
    const built = await buildRecipe(tapToGrow, registry);
    expect(built.files).toEqual([]);
    expect(built.doc).toEqual(buildRecipeDocument(tapToGrow, registry));
  });

  it("points recipes with a design import to buildRecipe", () => {
    expect(() => buildRecipeDocument(placemarkDeck, registry)).toThrow(RecipeBuildError);
    expect(() => buildRecipeDocument(placemarkDeck, registry)).toThrow(/imports a design.*await buildRecipe/);
  });

  it("imports the design first and keeps its asset files", async () => {
    const built = await buildRecipe(placemarkDeck, registry);
    const records = Object.values(built.doc.assets);
    expect(records.map((a) => a.id)).toEqual(expect.arrayContaining(["malasadas", "manoa_falls", "card_yes_heart"]));
    expect(built.files.map((f) => f.file).sort()).toEqual(records.map((a) => a.file).sort());
    expect(built.doc.knobs?.presets.find((p) => p.name === "Shipped app")?.locked).toBe(true);
  });

  it("tidies each comment frame's nodes inside it", async () => {
    const recipe: Recipe = {
      folder: "99-frames",
      name: "Frames",
      description: "d",
      guides: [],
      background: "#FFFFFFFF",
      notes: "n",
      tidy: "frames",
      ops: () => [
        { op: "addLayer", layer: rect("box", "Box", { size: [100, 100] }) },
        { op: "addPatch", patch: { id: "tap", type: "interaction", name: "Tap Box", inputs: { layer: layerRef("box") }, ui: { x: 40, y: 80 } } },
        { op: "addPatch", patch: { id: "grow", type: "popAnimation", name: "Grow", ui: { x: 60, y: 90 } } },
        connect("tap.down", "grow.number"),
        comment("section_tap", "TAP", [0, 0, 300, 200]),
      ],
    };
    const { doc } = await buildRecipe(recipe, registry);
    const main = doc.components[doc.project.root]!;
    const [x, y, w, h] = main.comments[0]!.rect;
    for (const id of ["tap", "grow"]) {
      const at = main.patches[id]!.ui;
      expect(at.x).toBeGreaterThanOrEqual(x);
      expect(at.y).toBeGreaterThanOrEqual(y + 30);
      expect(at.x).toBeLessThan(x + w);
      expect(at.y).toBeLessThan(y + h);
    }
    expect(main.patches.grow!.ui.x).toBeGreaterThan(main.patches.tap!.ui.x);
  });
});

describe("design imports and asset files", () => {
  it("names the photo a stored capture can't find", async () => {
    const dir = temp();
    const capture = { format: "sonobe.design-capture", version: 1, source: { kind: "html" }, viewport: { width: 10, height: 10 }, root: { kind: "frame", box: [0, 0, 10, 10], children: [] }, images: { img1: { url: "https://example.com/a.jpg" } } };
    writeFileSync(path.join(dir, "capture.json"), JSON.stringify(capture));
    writeFileSync(path.join(dir, "photos.json"), JSON.stringify({ photos: [] }));
    const rel = path.relative(EXAMPLES_DIR, dir);
    await expect(loadDesign({ capture: `${rel}/capture.json`, photos: `${rel}/photos.json` })).rejects.toThrow(/has no file for https:\/\/example\.com\/a\.jpg/);
  });

  it("reports asset files that differ or that the build no longer makes, and writes them", async () => {
    const dir = temp();
    const built = await buildRecipe(tapToGrow, registry);
    const doc = { ...built.doc, assets: { dot: { id: "dot", kind: "image" as const, name: "Dot", file: "abc.svg", mime: "image/svg+xml" } } };
    await saveProjectToDisk(dir, doc);
    const bytes = new TextEncoder().encode("<svg/>");
    expect(projectDrift(dir, doc, [{ file: "abc.svg", bytes }])).toEqual({ changed: ["assets/abc.svg"], extra: [] });
    mkdirSync(path.join(dir, "assets"), { recursive: true });
    writeFileSync(path.join(dir, "assets", "old.png"), "x");
    expect(writeAssetFiles(dir, [{ file: "abc.svg", bytes }])).toEqual({ written: ["assets/abc.svg"], removed: ["assets/old.png"] });
    expect(projectDrift(dir, doc, [{ file: "abc.svg", bytes }])).toEqual({ changed: [], extra: [] });
    expect(projectDrift(dir, doc, [])).toEqual({ changed: [], extra: ["assets/abc.svg"] });
  });
});
