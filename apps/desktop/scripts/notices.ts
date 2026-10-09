/**
 * The third-party notices the packaged app ships in Resources/licenses: every npm package whose code
 * ends up in a bundle, with its license text. The package list comes from what the bundlers report
 * (esbuild's metafiles, and the `sources` of the editor's source maps), never from a hand-kept list,
 * so a new dependency is covered by the build that first bundles it. A package that publishes other
 * packages inside its own files (@modelcontextprotocol/server carries ajv) names them in the source
 * maps it ships, and they are listed too. scripts/build.mjs --licenses writes the file.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * The package folders behind bundled files: each path up to the package name after its last
 * `node_modules/`. Files outside node_modules (this repository's own source) aren't third-party.
 */
export function npmPackageDirs(files: Iterable<string>): string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    const normal = file.replaceAll("\\", "/");
    const at = normal.lastIndexOf("/node_modules/");
    if (at < 0) continue;
    const [first, second] = normal.slice(at + "/node_modules/".length).split("/");
    if (!first || (first.startsWith("@") && !second)) continue;
    // Workspace packages are linked into node_modules, and they're this repository's own code.
    if (first === "@sonobe") continue;
    dirs.add(
      `${normal.slice(0, at)}/node_modules/${first.startsWith("@") ? `${first}/${second}` : first}`,
    );
  }
  return [...dirs].sort();
}

/** The files a bundle was made from, with something of theirs in an output: paths from an esbuild metafile. */
export function metafileInputs(
  metafile: { outputs: Record<string, { inputs: Record<string, { bytesInOutput: number }> }> },
  workingDir: string,
): string[] {
  const files = new Set<string>();
  for (const output of Object.values(metafile.outputs)) {
    for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
      // Plugin-made modules are named `namespace:path`; real files are paths from the working directory.
      if (bytesInOutput > 0 && !/^[\w-]{2,}:/.test(input))
        files.add(path.resolve(workingDir, input));
    }
  }
  return [...files];
}

/** The files a built folder's source maps name (Vite's editor build): each map's `sources`, from its own folder. */
export function sourceMapInputs(dir: string): string[] {
  const files = new Set<string>();
  if (!existsSync(dir)) return [];
  for (const entry of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    if (!entry.endsWith(".map")) continue;
    const map = path.join(dir, entry);
    const { sources = [], sourceRoot = "" } = JSON.parse(readFileSync(map, "utf8")) as {
      sources?: string[];
      sourceRoot?: string;
    };
    for (const source of sources) files.add(path.resolve(path.dirname(map), sourceRoot, source));
  }
  return [...files];
}

export interface CarriedPackage {
  name: string;
  /** From a pnpm store path (`.pnpm/ajv@8.18.0/node_modules/ajv`); undefined when the path has none. */
  version: string | undefined;
  /** The folder of the package whose files carry it. */
  within: string;
}

/** pnpm's store folder for a package: `.pnpm/ajv@8.18.0/node_modules/ajv`, scoped `.pnpm/@scope+name@1.0.0_peer@2/…`. */
const PNPM_STORE = /\/\.pnpm\/([^/]+)\/node_modules\/(?:@[^/]+\/)?[^/]+$/;

/**
 * The packages that bundled files carry inside them. A dependency can publish files that already
 * hold other packages, and a bundler reports only the file it read. The source map shipped beside
 * such a file names what it was made from: a source under a `node_modules/` is another package's.
 * The publisher's own sources aren't listed, wherever they sat, since its license covers them.
 */
export function carriedPackages(files: Iterable<string>): CarriedPackage[] {
  const carried = new Map<string, CarriedPackage>();
  for (const file of files) {
    const [within] = npmPackageDirs([file]);
    if (!within || !existsSync(`${file}.map`)) continue;
    const { sources = [] } = JSON.parse(readFileSync(`${file}.map`, "utf8")) as {
      sources?: string[];
    };
    // As written, not resolved: `../../shared/src` is the publisher's own folder, not a package.
    for (const dir of npmPackageDirs(sources.map((source) => `/${source}`))) {
      const name = dir.slice(dir.lastIndexOf("/node_modules/") + "/node_modules/".length);
      // `.pnpm` and `.vite` are folders in node_modules, not packages.
      if (name.startsWith(".") || within.endsWith(`/node_modules/${name}`)) continue;
      const stored = PNPM_STORE.exec(dir)?.[1];
      const prefix = `${name.replace("/", "+")}@`;
      const version = stored?.startsWith(prefix)
        ? stored.slice(prefix.length).split("_")[0]
        : undefined;
      carried.set(`${name} ${version ?? ""} in ${within}`, { name, version, within });
    }
  }
  return [...carried.values()];
}

/** The folder a package is installed in, looking where Node would from `from`; undefined when it isn't. */
export function installedPackageDir(name: string, from: string): string | undefined {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    if (path.dirname(dir) === dir) return undefined;
  }
}

export interface NoticePackage {
  name: string;
  version: string;
  /** The package.json `license` field; "UNKNOWN" when it has none. */
  license: string;
  repository: string | undefined;
  /** The package's own license file, word for word; undefined when it ships none. */
  text: string | undefined;
  /** For a carried package that isn't installed, so nothing of it could be read: the package that carries it. */
  carriedBy?: string;
}

const LICENSE_FILE = /^(licen[sc]e|copying|notice)([.-].*)?$/i;

/** One package's notice, read from its folder. */
export function readNoticePackage(dir: string): NoticePackage {
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
    license?: string | { type?: string };
    repository?: string | { url?: string };
  };
  const license = typeof pkg.license === "string" ? pkg.license : pkg.license?.type;
  const repository = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  // LICENSE before COPYING before NOTICE, and a plain name before LICENSE-MIT or LICENSE.md.
  const rank = (name: string) =>
    ["l", "c", "n"].indexOf(name[0]!.toLowerCase()) * 100 + name.length;
  const file = readdirSync(dir)
    .filter((name) => LICENSE_FILE.test(name))
    .sort((a, b) => rank(a) - rank(b))[0];
  return {
    name: pkg.name ?? path.basename(dir),
    version: pkg.version ?? "",
    license: license ?? "UNKNOWN",
    repository: repository?.replace(/^git\+/, "").replace(/\.git$/, ""),
    text: file
      ? readFileSync(path.join(dir, file), "utf8").replaceAll("\r\n", "\n").trim()
      : undefined,
  };
}

/**
 * Every package to give notice of for a set of bundled files: the packages the files belong to, and
 * the packages those carry inside them. A carried package's license is read from the copy installed
 * here, which may be another version than the carried one; the notice names the carried version.
 */
export function noticePackages(files: Iterable<string>): NoticePackage[] {
  const all = [...files];
  const packages = new Map<string, NoticePackage>();
  const add = (pkg: NoticePackage) => {
    if (!packages.has(`${pkg.name} ${pkg.version}`))
      packages.set(`${pkg.name} ${pkg.version}`, pkg);
  };
  for (const dir of npmPackageDirs(all)) add(readNoticePackage(dir));
  for (const { name, version, within } of carriedPackages(all)) {
    const dir = installedPackageDir(name, within);
    if (dir) add({ ...readNoticePackage(dir), ...(version ? { version } : {}) });
    else {
      const carriedBy = readNoticePackage(within).name;
      add({
        name,
        version: version ?? "",
        license: "UNKNOWN",
        repository: undefined,
        text: undefined,
        carriedBy,
      });
    }
  }
  return [...packages.values()];
}

const RULE = "-".repeat(78);

/**
 * The notices file: one block per package, sorted by name, the same text for the same packages.
 * `missing` names the packages that ship no license file; their block gives the license's name and
 * where the package lives instead.
 */
export function renderNotices(packages: readonly NoticePackage[]): {
  text: string;
  missing: string[];
} {
  const sorted = [...packages].sort(
    (a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"),
  );
  const blocks = sorted.map((pkg) =>
    [
      RULE,
      `${pkg.name} ${pkg.version}`.trim(),
      `License: ${pkg.license}`,
      ...(pkg.repository ? [`Source: ${pkg.repository}`] : []),
      RULE,
      "",
      pkg.text ??
        (pkg.carriedBy
          ? `This package's code is inside ${pkg.carriedBy}'s published files, without its license, and it isn't installed on its own to read one from. See ${pkg.carriedBy}'s source.`
          : `This package ships no license file. It is licensed under ${pkg.license}; see its source for the full text.`),
      "",
    ].join("\n"),
  );
  const header = [
    "Third-party notices for Sonobe",
    "",
    "Sonobe's own code is under the MIT license (LICENSE.txt, beside this file). The app is built on",
    "Electron (LICENSE.electron.txt) and Chromium (LICENSES.chromium.html). This file lists the npm",
    `packages whose code is bundled into the app, the editor and the sonobe CLI: ${sorted.length} packages,`,
    "each with its license.",
    "",
    "",
  ].join("\n");
  return {
    text: `${header}${blocks.join("\n")}`,
    missing: sorted.filter((pkg) => pkg.text === undefined).map((pkg) => pkg.name),
  };
}
