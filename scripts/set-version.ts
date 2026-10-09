#!/usr/bin/env node
/**
 * One version for everything that ships in or beside the desktop app, set with one command:
 *
 *   node scripts/set-version.ts 0.2.0           write it everywhere, then rebuild the examples
 *   node scripts/set-version.ts --check         print every place; exit 1 when they disagree
 *   node scripts/set-version.ts --check 0.2.0   also exit 1 when they aren't 0.2.0 (the release
 *                                               workflow, against the tag it was started by)
 *
 * The places that share the number (packages/cli/src/versions.test.ts fails when they disagree):
 *
 * - the root package.json and every workspace's, and their entries in package-lock.json
 * - EDITOR_VERSION in apps/editor/src/app/about.ts, what the editor shows without the desktop app
 * - GENERATOR in packages/core/src/document.ts, the stamp in every project a build saves, and
 *   so the example projects, which are rebuilt from their recipes (node examples/build.ts)
 * - the Claude Code plugin and the Claude Desktop extension, which bundle this version's CLI
 *
 * These keep their own numbers on purpose: saved documents, which record the version that wrote
 * them (evals/cases/<case>/start/project.json, packages/mcp/fixtures/node-sizes); the Chrome
 * extension's manifest and the generator names that Chrome and Figma captures carry, which
 * follow those tools' own releases; Sonobe Viewer (MARKETING_VERSION in apps/ios); and the
 * versions tests make up.
 *
 * It imports nothing outside Node, so the release workflow can run --check before `npm ci`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface VersionPlace {
  /** Path from the repository root. */
  file: string;
  /** The version the file's text holds; every one it holds when they disagree inside the file. */
  read(text: string): string;
  /** The text with the version replaced, and nothing else changed. */
  write(text: string, version: string): string;
}

/** A refusal: `message` says what is wrong, `hint` what to do about it. */
export class VersionError extends Error {
  readonly hint: string;

  constructor(message: string, hint: string) {
    super(message);
    this.name = "VersionError";
    this.hint = hint;
  }
}

/** Three plain numbers. The update feed is stable-only, so there is no prerelease form. */
export function assertVersion(version: string): void {
  if (/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) return;
  throw new VersionError(
    `The version must be three plain numbers, like 0.2.0 (got ${version || "nothing"}).`,
    "Sonobe's update feed is stable-only: a version with a suffix such as -beta.1, published as a normal release, would be offered to everyone.",
  );
}

/** A `"version": "…"` key at the top level of a JSON file, replaced where it stands. */
function jsonVersion(file: string): VersionPlace {
  const key = /^( {2}"version": ")([^"]*)(")/m;
  return {
    file,
    read: (text) => String((JSON.parse(text) as { version?: unknown }).version ?? "none"),
    write: (text, version) => {
      if (!key.test(text)) throw new Error(`${file} has no top-level "version" line`);
      return text.replace(key, `$1${version}$3`);
    },
  };
}

/** A string constant in source: `pattern` captures what comes before, the version, and after. */
function constant(file: string, pattern: RegExp): VersionPlace {
  return {
    file,
    read: (text) => pattern.exec(text)?.[2] ?? "none",
    write: (text, version) => {
      if (!pattern.test(text)) throw new Error(`${file} no longer matches ${pattern}`);
      return text.replace(pattern, `$1${version}$3`);
    },
  };
}

interface Lockfile {
  version?: string;
  packages: Record<string, { version?: string }>;
}

/** package-lock.json: the root's version twice, and each workspace's own entry. */
function lockfile(workspaces: readonly string[]): VersionPlace {
  const entries = (lock: Lockfile) => ["", ...workspaces].map((dir) => lock.packages[dir]);
  return {
    file: "package-lock.json",
    read: (text) => {
      const lock = JSON.parse(text) as Lockfile;
      const found = [lock.version, ...entries(lock).map((entry) => entry?.version)];
      return [...new Set(found.map((version) => version ?? "none"))].join(" and ");
    },
    // Through JSON, the way npm writes it, so another package's entry at the same number stays as it is.
    write: (text, version) => {
      const lock = JSON.parse(text) as Lockfile;
      lock.version = version;
      for (const entry of entries(lock)) if (entry) entry.version = version;
      return `${JSON.stringify(lock, null, 2)}\n`;
    },
  };
}

/** The folders of the root package.json's workspaces, in order. */
export function workspaceDirs(root: string): string[] {
  const { workspaces } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    workspaces: string[];
  };
  return workspaces.flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    return readdirSync(path.join(root, parent))
      .sort()
      .map((name) => `${parent}/${name}`)
      .filter((dir) => existsSync(path.join(root, dir, "package.json")));
  });
}

/** Every file that holds the version. */
export function versionPlaces(root: string): VersionPlace[] {
  const workspaces = workspaceDirs(root);
  return [
    jsonVersion("package.json"),
    ...workspaces.map((dir) => jsonVersion(`${dir}/package.json`)),
    lockfile(workspaces),
    constant("apps/editor/src/app/about.ts", /^(export const EDITOR_VERSION = ")([^"]*)(";)$/m),
    constant("packages/core/src/document.ts", /^(export const GENERATOR = "Sonobe )([^"]*)(";)$/m),
    jsonVersion("integrations/claude-code/.claude-plugin/plugin.json"),
    jsonVersion("integrations/claude-desktop/manifest.json"),
  ];
}

/** The version each place holds now. */
export function readVersions(root: string): { file: string; version: string }[] {
  return versionPlaces(root).map((place) => ({
    file: place.file,
    version: place.read(readFileSync(path.join(root, place.file), "utf8")),
  }));
}

/** Writes `version` into every place, and returns the files it changed. */
export function setVersion(root: string, version: string): string[] {
  assertVersion(version);
  const changed: string[] = [];
  for (const place of versionPlaces(root)) {
    const file = path.join(root, place.file);
    const before = readFileSync(file, "utf8");
    const after = place.write(before, version);
    if (place.read(after) !== version) throw new Error(`${place.file} didn't take ${version}`);
    if (after === before) continue;
    writeFileSync(file, after);
    changed.push(place.file);
  }
  return changed;
}

/** What `--check` reports: nothing when every place holds `expected` (or, without it, the root's). */
export function versionProblems(
  versions: readonly { file: string; version: string }[],
  expected?: string,
): string[] {
  const wanted = expected ?? versions[0]!.version;
  return versions
    .filter(({ version }) => version !== wanted)
    .map(({ file, version }) => `${file} has ${version}, not ${wanted}`);
}

function main(argv: string[]): number {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const check = argv.includes("--check");
  const [version, ...rest] = argv.filter((arg) => arg !== "--check");
  if (rest.length || version?.startsWith("-") || (!check && version === undefined)) {
    console.error(
      "Usage: node scripts/set-version.ts <x.y.z>   or   node scripts/set-version.ts --check [x.y.z]",
    );
    return 2;
  }
  try {
    if (check) {
      if (version !== undefined) assertVersion(version);
      const versions = readVersions(root);
      for (const { file, version: found } of versions) console.log(`${found.padEnd(8)} ${file}`);
      const problems = versionProblems(versions, version);
      if (!problems.length) return 0;
      for (const problem of problems) console.error(`[set-version] ${problem}`);
      console.error(
        `[set-version] ${version === undefined ? "The version isn't the same everywhere." : `The version isn't ${version} everywhere (a release tag must be v<version>).`} Set it with: node scripts/set-version.ts <x.y.z>`,
      );
      return 1;
    }
    const changed = setVersion(root, version!);
    // The examples carry GENERATOR, and are rebuilt from their recipes rather than edited.
    const examples = spawnSync(process.execPath, [path.join(root, "examples", "build.ts")], {
      cwd: root,
      stdio: "inherit",
    });
    if (examples.status !== 0) {
      console.error(
        "[set-version] The version is written, but the examples weren't rebuilt. Run: node examples/build.ts",
      );
      return 1;
    }
    console.log(
      changed.length
        ? `[set-version] ${version} written to:\n${changed.map((file) => `  ${file}`).join("\n")}`
        : `[set-version] Everything is already at ${version}.`,
    );
    console.log(
      "[set-version] The examples are rebuilt (git status shows which changed). Now run: npm run typecheck && npm test",
    );
    return 0;
  } catch (err) {
    if (!(err instanceof VersionError)) throw err;
    console.error(`[set-version] ${err.message}`);
    console.error(`[set-version] ${err.hint}`);
    return 1;
  }
}

// Real paths on both sides: Node resolves a symlinked folder for import.meta.url and not for argv, and
// a --check that silently did nothing would pass.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = main(process.argv.slice(2));
}
