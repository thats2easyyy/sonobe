import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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

  it("treats missing directories as empty and reports existence", async () => {
    const fs = createNodeFs();
    const root = await mkdtemp(join(tmpdir(), "sonobe-core-"));
    dirs.push(root);
    expect(await fs.list(join(root, "missing"))).toEqual([]);
    expect(await fs.exists(join(root, "missing"))).toBe(false);
    await fs.writeText(join(root, "a", "b.txt"), "hi");
    expect(await fs.readText(join(root, "a", "b.txt"))).toBe("hi");
    expect(await fs.list(join(root, "a"))).toEqual(["b.txt"]);
    await fs.remove(join(root, "a"));
    expect(await fs.exists(join(root, "a"))).toBe(false);
  });
});
