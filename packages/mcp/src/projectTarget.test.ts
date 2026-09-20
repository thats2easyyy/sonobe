import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkProjectTarget, isPlaceholderName, resolveProjectTarget, type ProjectTargetOptions } from "./projectTarget.ts";

let base: string;
let home: string;
/** The app's rules: inside home or tmp, never in the app's data folder or a hidden folder. */
let app: ProjectTargetOptions;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "sonobe-target-"));
  home = path.join(base, "home");
  await mkdir(path.join(home, "Documents", "Sonobe"), { recursive: true });
  app = { home, roots: [home, path.join(base, "tmp")], refused: [{ dir: path.join(home, "Library", "Sonobe"), why: "Sonobe keeps its settings and drafts there" }] };
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const code = (promise: Promise<unknown>) => promise.then(() => "ok", (err: { code?: string }) => err.code);

/** A Sonobe project folder on disk. */
async function project(dir: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "project.json"), '{ "formatVersion": 1, "name": "Noddit", "root": "main" }\n');
}

describe("new project folders", () => {
  it("expands ~, adds .sonobe, and resolves relative paths only against a working folder", async () => {
    expect(await resolveProjectTarget("~/Documents/Checkout Flow", app)).toBe(path.join(home, "Documents", "Checkout Flow.sonobe"));
    expect(await resolveProjectTarget(path.join(home, "Documents", "Deck.sonobe"), app)).toBe(path.join(home, "Documents", "Deck.sonobe"));
    expect(await code(resolveProjectTarget("Deck.sonobe", app))).toBe("absolute_path_required");
    expect(await resolveProjectTarget("./Deck", { cwd: base })).toBe(path.join(base, "Deck.sonobe"));
  });

  it("refuses a folder inside another project, and says where it could go instead", async () => {
    // The test session's case: the Save panel was inside noddit-test.sonobe.
    await project(path.join(home, "Documents", "Sonobe", "noddit-test.sonobe"));
    const nested = path.join(home, "Documents", "Sonobe", "noddit-test.sonobe", "Untitled.sonobe");
    const problem = await checkProjectTarget(nested, app);
    expect(problem).toMatchObject({ code: "inside_project", suggestion: path.join(home, "Documents", "Sonobe", "Untitled.sonobe") });
    await expect(resolveProjectTarget(nested, app)).rejects.toMatchObject({ code: "inside_project", hint: expect.stringContaining("next to that project") });
    // A folder holding a Sonobe project.json counts even without the extension; deeper folders too.
    await project(path.join(home, "Work", "proto"));
    expect(await code(resolveProjectTarget("~/Work/proto/screens/Card", app))).toBe("inside_project");
    // Any other project.json doesn't.
    await mkdir(path.join(home, "Code", "site"), { recursive: true });
    await writeFile(path.join(home, "Code", "site", "project.json"), '{ "name": "site" }\n');
    expect(await code(resolveProjectTarget("~/Code/site/Card", app))).toBe("ok");
  });

  it("never picks a folder that exists with something in it", async () => {
    await project(path.join(home, "Documents", "Deck.sonobe"));
    expect(await code(resolveProjectTarget("~/Documents/Deck.sonobe", app))).toBe("already_exists");
    await mkdir(path.join(home, "Documents", "Notes.sonobe"));
    await writeFile(path.join(home, "Documents", "Notes.sonobe", "notes.txt"), "mine\n");
    await expect(resolveProjectTarget("~/Documents/Notes.sonobe", app)).rejects.toMatchObject({ code: "folder_not_empty", message: expect.stringContaining("notes.txt") });
    await writeFile(path.join(home, "Documents", "Paper.sonobe"), "a file\n");
    expect(await code(resolveProjectTarget("~/Documents/Paper.sonobe", app))).toBe("already_exists");
    // An empty folder, or one with only OS litter, is fine.
    await mkdir(path.join(home, "Documents", "Empty.sonobe"));
    await writeFile(path.join(home, "Documents", "Empty.sonobe", ".DS_Store"), "");
    expect(await code(resolveProjectTarget("~/Documents/Empty.sonobe", app))).toBe("ok");
    // The Save panel may replace an existing prototype (the person confirmed it), but not merge into other files.
    expect(await checkProjectTarget(path.join(home, "Documents", "Deck.sonobe"), { allowExistingProject: true })).toBeNull();
    expect(await checkProjectTarget(path.join(home, "Documents", "Notes.sonobe"), { allowExistingProject: true })).toMatchObject({ code: "folder_not_empty" });
  });

  it("keeps the app's agent paths in home, a drive or tmp, out of hidden folders and Sonobe's own data", async () => {
    expect(await code(resolveProjectTarget(path.join(base, "tmp", "Scratch"), app))).toBe("ok");
    expect(await code(resolveProjectTarget(path.join(base, "elsewhere", "Deck"), app))).toBe("path_not_allowed");
    await expect(resolveProjectTarget("~/Library/Sonobe/Drafts/Deck", app)).rejects.toMatchObject({ code: "path_not_allowed", message: expect.stringContaining("drafts") });
    await expect(resolveProjectTarget("~/.config/Deck", app)).rejects.toMatchObject({ code: "path_not_allowed", message: expect.stringContaining('".config"') });
    // Headless has no roots: anywhere the folder rules allow.
    expect(await code(resolveProjectTarget(path.join(base, "elsewhere", "Deck"), { cwd: base }))).toBe("ok");
  });

  it("knows placeholder names", () => {
    for (const name of ["Untitled", "untitled 2", "", "  "]) expect(isPlaceholderName(name)).toBe(true);
    for (const name of ["Noddit Deck", "Untitled Deck", "Photo Zoom"]) expect(isPlaceholderName(name)).toBe(false);
  });
});
