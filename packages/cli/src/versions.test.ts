/**
 * One version everywhere it lives (scripts/set-version.ts): the places agree, the script rewrites
 * each of them without touching anything else, and nothing in the docs needs a bump.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATOR } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import {
  VersionError,
  assertVersion,
  readVersions,
  versionPlaces,
  versionProblems,
  workspaceDirs,
} from "../../../scripts/set-version.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const current = (JSON.parse(read("package.json")) as { version: string }).version;

describe("the version", () => {
  it("is the same everywhere it lives", () => {
    const versions = readVersions(ROOT);
    // Fix a disagreement with: node scripts/set-version.ts <x.y.z>
    expect(versionProblems(versions)).toEqual([]);
    expect(versions.every(({ version }) => version === current)).toBe(true);
    expect(() => assertVersion(current)).not.toThrow();
  });

  it("covers every workspace, the lockfile, the editor, the generator stamp and the Claude integrations", () => {
    const files = versionPlaces(ROOT).map((place) => place.file);
    const lock = JSON.parse(read("package-lock.json")) as {
      packages: Record<string, { link?: boolean; resolved?: string }>;
    };
    // The lockfile's own list of workspaces: every folder a node_modules/@sonobe link points to.
    const linked = Object.values(lock.packages).flatMap((entry) =>
      entry.link && entry.resolved ? [entry.resolved] : [],
    );
    expect(workspaceDirs(ROOT).sort()).toEqual(linked.sort());
    for (const dir of linked) expect(files).toContain(`${dir}/package.json`);
    expect(files).toEqual(
      expect.arrayContaining([
        "package.json",
        "package-lock.json",
        "apps/editor/src/app/about.ts",
        "packages/core/src/document.ts",
        "integrations/claude-code/.claude-plugin/plugin.json",
        "integrations/claude-desktop/manifest.json",
      ]),
    );
    expect(new Set(files).size).toBe(files.length);
  });

  it("reaches the generator stamp, and the examples rebuilt from it", () => {
    expect(GENERATOR).toBe(`Sonobe ${current}`);
    const example = JSON.parse(read("examples/01-tap-to-grow/project.json")) as {
      generator: string;
    };
    // After a bump: node examples/build.ts (set-version.ts runs it).
    expect(example.generator).toBe(GENERATOR);
  });
});

describe("set-version.ts", () => {
  it("writes the current version back without changing a byte, the lockfile included", () => {
    for (const place of versionPlaces(ROOT)) {
      const text = read(place.file);
      expect(place.write(text, current) === text, place.file).toBe(true);
    }
  });

  it("writes a new version into every place, and only there", () => {
    for (const place of versionPlaces(ROOT)) {
      const text = read(place.file);
      const bumped = place.write(text, "9.9.9");
      expect(place.read(bumped), place.file).toBe("9.9.9");
      expect(place.write(bumped, current) === text, place.file).toBe(true);
    }
    // Another package at the same number stays as it is.
    const lock = versionPlaces(ROOT).find((place) => place.file === "package-lock.json")!;
    const entries = (version: string) =>
      Object.fromEntries(workspaceDirs(ROOT).map((dir) => [dir, { version }]));
    const lockText = (workspaces: Record<string, { version: string }>) =>
      `${JSON.stringify({ name: "sonobe", version: "1.0.0", packages: { "": { version: "1.0.0" }, ...workspaces, "node_modules/other": { version: "1.0.0" } } }, null, 2)}\n`;
    const written = JSON.parse(lock.write(lockText(entries("1.0.0")), "2.0.0")) as {
      version: string;
      packages: Record<string, { version: string }>;
    };
    expect(written.version).toBe("2.0.0");
    expect(written.packages[""]!.version).toBe("2.0.0");
    expect(written.packages["apps/desktop"]!.version).toBe("2.0.0");
    expect(written.packages["node_modules/other"]!.version).toBe("1.0.0");
    expect(lock.read(JSON.stringify(written))).toBe("2.0.0");
    // A lockfile whose entries disagree reads as every version it holds.
    const mixed = { ...entries("1.0.0"), "apps/desktop": { version: "0.9.0" } };
    expect(lock.read(lockText(mixed))).toBe("1.0.0 and 0.9.0");
  });

  it("names the file that disagrees, against the root or against a release tag", () => {
    const versions = [
      { file: "package.json", version: "0.2.0" },
      { file: "apps/desktop/package.json", version: "0.1.0" },
    ];
    expect(versionProblems(versions)).toEqual(["apps/desktop/package.json has 0.1.0, not 0.2.0"]);
    expect(versionProblems(versions, "0.1.0")).toEqual(["package.json has 0.2.0, not 0.1.0"]);
    expect(versionProblems(versions.slice(0, 1), "0.2.0")).toEqual([]);
  });

  it("takes three plain numbers, and says why a prerelease isn't one", () => {
    for (const version of ["0.2.0", "1.0.0", "10.20.30"]) {
      expect(() => assertVersion(version)).not.toThrow();
    }
    for (const version of ["1.2", "v1.2.3", "1.2.3-beta.1", "01.2.3", "1.2.3.4", ""]) {
      expect(() => assertVersion(version), version).toThrow(VersionError);
    }
    try {
      assertVersion("1.2.3-beta.1");
    } catch (err) {
      expect((err as VersionError).message).toBe(
        "The version must be three plain numbers, like 0.2.0 (got 1.2.3-beta.1).",
      );
      expect((err as VersionError).hint).toContain("stable-only");
    }
  });
});

describe("the docs", () => {
  /** Markdown people read, and the packaging scripts whose headers show file names. */
  function prose(): string[] {
    const guides = readdirSync(path.join(ROOT, "docs/guides")).map((name) => `docs/guides/${name}`);
    const scripts = readdirSync(path.join(ROOT, "apps/desktop/scripts")).map(
      (name) => `apps/desktop/scripts/${name}`,
    );
    return [
      "README.md",
      "ARCHITECTURE.md",
      "CONTRIBUTING.md",
      "ROADMAP.md",
      "CLAUDE.md",
      "apps/desktop/README.md",
      "apps/desktop/electron-builder.yml",
      ...guides,
      ...scripts,
    ].filter((file) => existsSync(path.join(ROOT, file)));
  }

  it("name a release's files with <version>, so a bump leaves them alone", () => {
    for (const file of prose()) {
      expect(read(file), file).not.toMatch(/Sonobe-\d+\.\d+\.\d+/);
    }
    expect(read("README.md")).toContain("Sonobe-<version>-mac-arm64.dmg");
  });
});
