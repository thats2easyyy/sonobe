import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
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

const saved = async () => (JSON.parse(await readFile(file, "utf8")) as { projects: string[] }).projects;

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

  it("loads from disk, skipping entries that aren't absolute paths", async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ version: 1, projects: [projects[0], "relative/x.sonobe", 7, projects[1]] }));
    const recents = new RecentProjects(file);
    expect(await recents.list()).toEqual([projects[0], projects[1]]);
    expect(recents.snapshot()).toEqual([projects[0], projects[1]]);
  });

  it("keeps a folder that isn't there in the saved list, and leaves it out until it's back", async () => {
    const unplugged = path.join(dir, "Drive", "On a drive.sonobe");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ version: 1, projects: [projects[0], unplugged, projects[1]] }));
    const recents = new RecentProjects(file);
    // Reading the list looks at nothing, so every saved folder is in it.
    expect(await recents.list()).toEqual([projects[0], unplugged, projects[1]]);
    expect(recents.snapshot()).toEqual([projects[0], unplugged, projects[1]]);
    expect(recents.hasMissing()).toBe(false);

    expect(await recents.available()).toEqual([projects[0], projects[1]]);
    expect(recents.snapshot()).toEqual([projects[0], projects[1]]);
    expect(recents.hasMissing()).toBe(true);
    // Nothing was written: the file still names it, and so does the list.
    expect(await saved()).toEqual([projects[0], unplugged, projects[1]]);
    expect(await recents.list()).toEqual([projects[0], unplugged, projects[1]]);

    // Opening another project writes the list, with the missing folder still in it.
    await recents.add(projects[2]!);
    expect(await saved()).toEqual([projects[2], projects[0], unplugged, projects[1]]);
    expect(recents.snapshot()).toEqual([projects[2], projects[0], projects[1]]);

    // The drive is plugged in again.
    await mkdir(unplugged, { recursive: true });
    expect(await recents.available()).toEqual([projects[2], projects[0], unplugged, projects[1]]);
    expect(recents.hasMissing()).toBe(false);
  });

  it("drops a folder that went away from what it lists, and brings it back when it returns", async () => {
    const recents = new RecentProjects(file);
    await recents.add(projects[0]!);
    await recents.add(projects[1]!);
    await rename(projects[1]!, `${projects[1]!}.away`);
    expect(await recents.available()).toEqual([projects[0]]);
    await rename(`${projects[1]!}.away`, projects[1]!);
    expect(await recents.available()).toEqual([projects[1], projects[0]]);
    expect(await saved()).toEqual([projects[1], projects[0]]);
  });

  it("lists a folder that was just opened first, even one the last look didn't find", async () => {
    const late = path.join(dir, "Late.sonobe");
    const recents = new RecentProjects(file);
    await recents.add(projects[0]!);
    await recents.add(late);
    expect(await recents.available()).toEqual([projects[0]]);
    await mkdir(late);
    expect(await recents.add(late)).toEqual([late, projects[0]]);
    expect(recents.snapshot()).toEqual([late, projects[0]]);
    expect(recents.hasMissing()).toBe(false);
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

  it("forgets what was missing when it's removed or the list is cleared", async () => {
    const gone = path.join(dir, "Gone.sonobe");
    const recents = new RecentProjects(file);
    await recents.add(gone);
    await recents.add(projects[0]!);
    await recents.available();
    expect(recents.hasMissing()).toBe(true);
    await recents.remove(gone);
    expect(recents.hasMissing()).toBe(false);
    await recents.add(gone);
    await recents.available();
    await recents.clear();
    expect(recents.hasMissing()).toBe(false);
    expect(recents.snapshot()).toEqual([]);
  });

  it("survives a corrupt file", async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "{{{");
    expect(await new RecentProjects(file).list()).toEqual([]);
  });
});

describe("a folder whose check never answers (a share that hangs)", () => {
  /** Folders under /hung never answer; `release()` lets them. */
  function hanging() {
    const calls: string[] = [];
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const exists = async (target: string) => {
      calls.push(target);
      if (target.startsWith("/hung/")) await released;
      return true;
    };
    return { calls, exists, release };
  }

  it("counts as missing after its time, without holding up the others", async () => {
    const share = hanging();
    const recents = new RecentProjects(file, { exists: share.exists, checkTimeoutMs: 20 });
    for (const p of [projects[1]!, "/hung/Stuck.sonobe", projects[0]!]) await recents.add(p);
    const started = Date.now();
    expect(await recents.available()).toEqual([projects[0], projects[1]]);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(await saved()).toEqual([projects[0], "/hung/Stuck.sonobe", projects[1]]);
    // When the share answers after all, the next look lists it again.
    share.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await recents.available()).toEqual([projects[0], "/hung/Stuck.sonobe", projects[1]]);
  });

  it("is asked about once however often the list is looked at, and at most three checks ever wait", async () => {
    const share = hanging();
    const recents = new RecentProjects(file, { exists: share.exists, checkTimeoutMs: 10 });
    const hung = ["/hung/One.sonobe", "/hung/Two.sonobe", "/hung/Three.sonobe", "/hung/Four.sonobe"];
    for (const p of [...hung].reverse()) await recents.add(p);
    await recents.add(projects[0]!);
    for (let i = 0; i < 5; i++) await recents.available();
    // Two are checked at a time, and once two have run out of time no new check starts: three were asked, each once, in
    // five looks. A fourth would take the last of the file system's threads.
    expect(share.calls.filter((p) => p.startsWith("/hung/")).sort()).toEqual(["/hung/One.sonobe", "/hung/Three.sonobe", "/hung/Two.sonobe"]);
    // While they hang nothing else is asked about either, the folder on this disk included: it stays as the first look found it.
    expect(share.calls.filter((p) => p === projects[0])).toHaveLength(1);
    // The ones that ran out of time are left out. The one never asked about stays as it was.
    expect(recents.snapshot()).toEqual([projects[0], "/hung/Four.sonobe"]);
    share.release();
  });

  it("shares one look between calls made while it runs", async () => {
    const share = hanging();
    const recents = new RecentProjects(file, { exists: share.exists, checkTimeoutMs: 20 });
    await recents.add(projects[0]!);
    await recents.add(projects[1]!);
    const [a, b] = await Promise.all([recents.available(), recents.available()]);
    expect(a).toEqual(b);
    expect(share.calls).toHaveLength(2);
  });
});
