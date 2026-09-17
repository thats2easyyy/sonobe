import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeFs, loadProjectFromDisk, saveProjectToDisk } from "./node.ts";
import { buildSampleDocument, mustApply } from "./testing/fixtures.ts";

const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("node file system adapter", () => {
  it("saves, loads and cleans up a project folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "sonobe-core-"));
    dirs.push(root);
    const dir = join(root, "Demo.sonobe");
    const doc = mustApply(buildSampleDocument(), [{ op: "addComponent", component: { name: "Chip", kind: "patchComponent" } }]).doc;
    await saveProjectToDisk(dir, doc);
    expect((await readdir(join(dir, "components"))).sort()).toEqual(["chip.json", "main.json"]);
    expect(await readFile(join(dir, "project.json"), "utf8")).toContain('"root": "main"');
    expect(await loadProjectFromDisk(dir)).toStrictEqual(doc);

    const next = mustApply(doc, [{ op: "removeComponent", id: "chip" }]).doc;
    const result = await saveProjectToDisk(dir, next);
    expect(result.removed).toEqual(["components/chip.json"]);
    expect(await readdir(join(dir, "components"))).toEqual(["main.json"]);
  });

  it("opens projects with folders in scripts/ and components/, and saving keeps them", async () => {
    const root = await mkdtemp(join(tmpdir(), "sonobe-core-"));
    dirs.push(root);
    const dir = join(root, "Helpers.sonobe");
    const doc = mustApply(buildSampleDocument(), [{ op: "setScript", file: "js_1.js", source: "// one\n" }]).doc;
    await saveProjectToDisk(dir, doc);
    await mkdir(join(dir, "scripts", "lib"), { recursive: true });
    await writeFile(join(dir, "scripts", "lib", "math.js"), "export const x = 1;\n");
    await writeFile(join(dir, "scripts", ".eslintrc.json"), "{}\n");
    await writeFile(join(dir, "scripts", "my helper.js"), "// spaces\n");
    await mkdir(join(dir, "components", "archive.json"), { recursive: true });
    await writeFile(join(dir, "components", "archive.json", "old.json"), "{}\n");

    const loaded = await loadProjectFromDisk(dir);
    expect(Object.keys(loaded.scripts)).toEqual(["js_1.js"]);

    const result = await saveProjectToDisk(dir, mustApply(loaded, [{ op: "setScript", file: "js_1.js", source: null }]).doc);
    expect(result.removed).toEqual(["scripts/js_1.js"]);
    expect((await readdir(join(dir, "scripts"))).sort()).toEqual([".eslintrc.json", "lib", "my helper.js"]);
    expect(await readFile(join(dir, "scripts", "lib", "math.js"), "utf8")).toContain("x = 1");
    expect(await readdir(join(dir, "components", "archive.json"))).toEqual(["old.json"]);
  });

  it("treats missing directories as empty and reports existence", async () => {
    const fs = createNodeFs();
    const root = await mkdtemp(join(tmpdir(), "sonobe-core-"));
    dirs.push(root);
    expect(await fs.list(join(root, "missing"))).toEqual([]);
    expect(await fs.exists(join(root, "missing"))).toBe(false);
    await fs.writeText(join(root, "a", "b.txt"), "hi");
    expect(await fs.readText(join(root, "a", "b.txt"))).toBe("hi");
    expect(await fs.list(join(root, "a"))).toEqual(["b.txt"]);
    expect(await fs.list(join(root, "a", "b.txt"))).toEqual([]);
    expect(await fs.isFile!(join(root, "a", "b.txt"))).toBe(true);
    expect(await fs.isFile!(join(root, "a"))).toBe(false);
    expect(await fs.isFile!(join(root, "missing"))).toBe(false);
    // Folders are never removed (someone's helpers may live in one); files are.
    await fs.remove(join(root, "a"));
    expect(await fs.exists(join(root, "a", "b.txt"))).toBe(true);
    await fs.remove(join(root, "a", "b.txt"));
    expect(await fs.exists(join(root, "a", "b.txt"))).toBe(false);
  });
});
