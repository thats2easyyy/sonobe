import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecentProjects } from "./recent-projects.ts";

let dir: string;
let file: string;
const projects: string[] = [];

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sonobe-recent-"));
  file = path.join(dir, "userData", "recent-projects.json");
  projects.length = 0;
  for (const name of ["A", "B", "C", "D"]) {
    const p = path.join(dir, `${name}.sonobe`);
    await mkdir(p);
    projects.push(p);
  }
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("RecentProjects", () => {
  it("keeps most recent first, dedupes, and caps the list", async () => {
    const recents = new RecentProjects(file, { max: 3 });
    await recents.add(projects[0]!);
    await recents.add(projects[1]!);
    await recents.add(`${projects[0]!}/`);
    await recents.add(projects[2]!);
    await recents.add(projects[3]!);
    expect(await recents.list()).toEqual([projects[3], projects[2], projects[0]]);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, projects: [projects[3], projects[2], projects[0]] });
  });

  it("loads from disk and drops folders that no longer exist", async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ version: 1, projects: [projects[0], path.join(dir, "Gone.sonobe"), "relative/x.sonobe", 7, projects[1]] }));
    const recents = new RecentProjects(file);
    expect(await recents.list()).toEqual([projects[0], projects[1]]);
    expect(recents.snapshot()).toEqual([projects[0], projects[1]]);
  });

  it("removes and clears", async () => {
    const recents = new RecentProjects(file);
    await recents.add(projects[0]!);
    await recents.add(projects[1]!);
    await recents.remove(projects[0]!);
    expect(await recents.list()).toEqual([projects[1]]);
    await recents.clear();
    expect(await new RecentProjects(file).list()).toEqual([]);
  });

  it("survives a corrupt file", async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "{{{");
    expect(await new RecentProjects(file).list()).toEqual([]);
  });
});
