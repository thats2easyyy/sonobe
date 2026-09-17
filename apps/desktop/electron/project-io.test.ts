import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OwnWriteRegistry,
  ProjectAccess,
  ProjectPathError,
  isBinaryProjectPath,
  isIgnoredProjectPath,
  readProject,
  resolveProjectSelection,
  validateRelativePath,
  writeProject,
} from "./project-io.ts";

let root: string;
let project: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "sonobe-io-"));
  project = path.join(root, "Checkout Flow.sonobe");
  await mkdir(path.join(project, "components"), { recursive: true });
  await mkdir(path.join(project, "assets"), { recursive: true });
  await mkdir(path.join(project, ".git"), { recursive: true });
  await mkdir(path.join(project, ".sonobe"), { recursive: true });
  await writeFile(path.join(project, "project.json"), '{\n  "formatVersion": 1\n}\n');
  await writeFile(path.join(project, "components", "main.json"), "{}\n");
  await writeFile(path.join(project, "assets", "assets.json"), "{}\n");
  await writeFile(path.join(project, "assets", "ab12.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255]));
  await writeFile(path.join(project, ".sonobe", "session.json"), '{"camera":1}');
  await writeFile(path.join(project, ".git", "HEAD"), "ref: refs/heads/main");
  await writeFile(path.join(project, ".DS_Store"), "junk");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("validateRelativePath", () => {
  it("accepts normal project paths", () => {
    for (const p of ["project.json", "components/main.json", "assets/ab12.png", "scripts/js_1.js", ".sonobe/session.json"]) expect(validateRelativePath(p)).toBe(p);
  });

  it("rejects traversal, absolute, and reserved paths", () => {
    for (const p of ["", "/etc/passwd", "C:/Windows", "../escape.json", "components/../../x", "a//b", "./a", "a\\b", "x\0y", ".git/config", "node_modules/x/index.js", "a/.DS_Store", 42]) {
      expect(() => validateRelativePath(p), String(p)).toThrow(ProjectPathError);
    }
  });
});

describe("classification", () => {
  it("treats assets and non-text files as binary", () => {
    expect(isBinaryProjectPath("assets/ab12.png")).toBe(true);
    expect(isBinaryProjectPath("assets/lottie.json")).toBe(true);
    expect(isBinaryProjectPath("assets/assets.json")).toBe(false);
    expect(isBinaryProjectPath("components/main.json")).toBe(false);
    expect(isBinaryProjectPath("scripts/js_1.js")).toBe(false);
    expect(isBinaryProjectPath("thumbnail.png")).toBe(true);
    expect(isIgnoredProjectPath("components/.main.json.sonobe-tmp-abc")).toBe(true);
  });
});

describe("readProject", () => {
  it("reads text and binary files with sorted keys, skipping VCS and OS files", async () => {
    const result = await readProject(project);
    expect(Object.keys(result.files)).toEqual([".sonobe/session.json", "assets/assets.json", "components/main.json", "project.json"]);
    expect(result.files["project.json"]).toBe('{\n  "formatVersion": 1\n}\n');
    expect(Object.keys(result.binaries)).toEqual(["assets/ab12.png"]);
    expect([...result.binaries["assets/ab12.png"]!]).toEqual([0x89, 0x50, 0x4e, 0x47, 0, 255]);
  });

  it("never follows symlinks out of the project", async () => {
    const outside = path.join(root, "secret.json");
    await writeFile(outside, '{"secret":true}');
    await symlink(outside, path.join(project, "components", "link.json"));
    const result = await readProject(project);
    expect(result.files["components/link.json"]).toBeUndefined();
  });

  it("fails clearly for missing folders and oversized projects", async () => {
    await expect(readProject(path.join(root, "Missing.sonobe"))).rejects.toMatchObject({ code: "not_found" });
    await expect(readProject(project, { maxFiles: 2 })).rejects.toMatchObject({ code: "too_large" });
    await expect(readProject(project, { maxBytes: 10 })).rejects.toMatchObject({ code: "too_large" });
  });
});

describe("writeProject", () => {
  it("writes text and binaries, deletes files, and prunes empty folders", async () => {
    const registry = new OwnWriteRegistry();
    await writeFile(path.join(project, "components", "old.json"), "{}");
    await mkdir(path.join(project, "scripts"), { recursive: true });
    await writeFile(path.join(project, "scripts", "js_1.js"), "// old");

    const result = await writeProject(
      project,
      {
        files: { "components/main.json": '{"id":"main"}\n', "components/card.json": "{}\n" },
        binaries: { "assets/cd34.png": new Uint8Array([1, 2, 3]).buffer, "assets/ef56.bin": new Uint8Array([9]) },
        deleted: ["components/old.json", "scripts/js_1.js", "components/never-existed.json"],
      },
      { ownWrites: registry },
    );

    expect(result.written).toEqual(["assets/cd34.png", "assets/ef56.bin", "components/card.json", "components/main.json"]);
    expect(await readFile(path.join(project, "components", "main.json"), "utf8")).toBe('{"id":"main"}\n');
    expect([...(await readFile(path.join(project, "assets", "cd34.png")))]).toEqual([1, 2, 3]);
    expect(existsSync(path.join(project, "components", "old.json"))).toBe(false);
    expect(existsSync(path.join(project, "scripts"))).toBe(false);
    expect((await readdir(path.join(project, "components"))).some((n) => n.includes("sonobe-tmp"))).toBe(false);

    expect(registry.matches(project, "components/main.json", Buffer.from('{"id":"main"}\n'))).toBe(true);
    expect(registry.matches(project, "components/main.json", Buffer.from("changed"))).toBe(false);
    expect(registry.matches(project, "components/old.json", null)).toBe(true);
  });

  it("creates a new project folder", async () => {
    const fresh = path.join(root, "Nested", "New.sonobe");
    await writeProject(fresh, { files: { "project.json": "{}\n" } });
    expect(await readFile(path.join(fresh, "project.json"), "utf8")).toBe("{}\n");
  });

  it("validates everything before touching the disk", async () => {
    await expect(writeProject(project, { files: { "components/main.json": "changed", "../evil.json": "x" } })).rejects.toThrow(ProjectPathError);
    expect(await readFile(path.join(project, "components", "main.json"), "utf8")).toBe("{}\n");
    await expect(writeProject(project, { files: { "a.json": "1" }, deleted: ["a.json"] })).rejects.toThrow(/both written and deleted/);
    await expect(writeProject(project, { files: { "a.json": "1" }, binaries: { "a.json": new Uint8Array() } })).rejects.toThrow(/both files and binaries/);
    await expect(writeProject(project, { binaries: { "assets/x.png": "not bytes" as never } })).rejects.toThrow(/ArrayBuffer/);
  });
});

describe("ProjectAccess", () => {
  it("allows approved folders and existing *.sonobe projects only", async () => {
    const access = new ProjectAccess();
    expect(await access.canAccess(project)).toBe(true);
    expect(await access.canAccess(root)).toBe(false);
    expect(await access.canAccess("relative/Thing.sonobe")).toBe(false);
    expect(await access.canAccess(42)).toBe(false);

    const plain = path.join(root, "Plain");
    await mkdir(plain);
    await writeFile(path.join(plain, "project.json"), "{}");
    expect(await access.canAccess(plain)).toBe(false);
    access.approve(plain);
    expect(await access.canAccess(plain)).toBe(true);

    const notYetCreated = path.join(root, "Draft.sonobe");
    expect(await access.canAccess(notYetCreated)).toBe(false);
    access.approve(notYetCreated);
    expect(await access.canAccess(notYetCreated)).toBe(true);
  });
});

describe("resolveProjectSelection", () => {
  it("maps picks to project folders", async () => {
    expect(await resolveProjectSelection(project)).toBe(project);
    expect(await resolveProjectSelection(path.join(project, "project.json"))).toBe(project);
    expect(await resolveProjectSelection(path.join(project, "components", "main.json"))).toBeNull();
    expect(await resolveProjectSelection(root)).toBeNull();
    expect(await resolveProjectSelection(path.join(root, "nope.sonobe"))).toBeNull();
  });
});
