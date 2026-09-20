/**
 * Finding Claude's agent adapter (@agentclientprotocol/claude-agent-acp). It's ~270 MB with its
 * native Claude Code, so Sonobe doesn't bundle it: the person installs it with npm, and Sonobe looks
 * where npm, Homebrew, Volta, Bun, pnpm and the Node version managers put global commands, since an
 * app opened from the Finder gets a bare PATH. Its bin is a Node script, which Sonobe runs with
 * Electron's own Node, so no system Node is needed to run it. Pure apart from reading the file system.
 */

import { accessSync, closeSync, constants, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLAUDE_AGENT_BIN, CLAUDE_AGENT_ENV, CLAUDE_AGENT_PACKAGE, type ClaudeAgentSpec, type LocateClaudeAgent } from "./types.ts";

const JS_ENTRY = /\.(?:js|mjs|cjs)$/i;
/** `#!/usr/bin/env node`, `#!/usr/bin/env -S node --flags`, `#!/usr/local/bin/node`. */
const NODE_SHEBANG = /^#![^\n]*[\s/]node(?:\s|$)/;

/** `file` with the home folder as "~". */
export function displayPath(file: string, home: string): string {
  if (!home || home === path.parse(home).root) return file;
  if (file === home) return "~";
  return file.startsWith(home + path.sep) ? `~${path.sep}${file.slice(home.length + 1)}` : file;
}

/**
 * The folders besides PATH where global npm commands end up: Homebrew's and the Node installer's,
 * npm's own prefix (~/.npm-global, or the one ~/.npmrc sets), ~/.local, Volta, Bun, pnpm on macOS,
 * npm on Windows, then each Node that nvm, mise, asdf or fnm installed (newest first; a global npm
 * install lands in that Node's bin) and mise's and asdf's shims. ./process.ts adds them to the
 * adapter's PATH too.
 */
export function wellKnownBinDirs(options: { platform: NodeJS.Platform; home: string; env: Record<string, string | undefined> }): string[] {
  const { platform, home, env } = options;
  const dirs = platform === "win32" ? [] : ["/opt/homebrew/bin", "/usr/local/bin"];
  if (home) {
    dirs.push(path.join(home, ".npm-global", "bin"));
    const prefix = npmrcPrefix(home);
    if (prefix) dirs.push(platform === "win32" ? prefix : path.join(prefix, "bin"));
    dirs.push(...[".local/bin", ".volta/bin", ".bun/bin"].map((dir) => path.join(home, dir)));
    if (platform === "darwin") dirs.push(path.join(home, "Library", "pnpm"));
  }
  if (platform === "win32" && env.APPDATA) dirs.push(path.join(env.APPDATA, "npm"));
  if (home && platform !== "win32") dirs.push(...nodeManagerBinDirs(platform, home, env));
  return dirs;
}

/** Each Node that nvm, mise, asdf and fnm installed, newest first, then mise's and asdf's shims: only what's there. */
function nodeManagerBinDirs(platform: NodeJS.Platform, home: string, env: Record<string, string | undefined>): string[] {
  const absolute = (value: string | undefined) => (value && path.isAbsolute(value) ? value : null);
  const data = absolute(env.XDG_DATA_HOME) ?? path.join(home, ".local", "share");
  const mise = absolute(env.MISE_DATA_DIR) ?? path.join(data, "mise");
  const asdf = absolute(env.ASDF_DATA_DIR) ?? path.join(home, ".asdf");
  // fnm's folder moved over the years: FNM_DIR, else the XDG one, macOS's older one, and the oldest.
  const fnmDir = absolute(env.FNM_DIR);
  const fnm = fnmDir ? [fnmDir] : [path.join(data, "fnm"), ...(platform === "darwin" ? [path.join(home, "Library", "Application Support", "fnm")] : []), path.join(home, ".fnm")];
  return [
    ...versionDirs(path.join(home, ".nvm", "versions", "node"), "bin"),
    ...versionDirs(path.join(mise, "installs", "node"), "bin"),
    ...versionDirs(path.join(asdf, "installs", "nodejs"), "bin"),
    ...fnm.flatMap((dir) => versionDirs(path.join(dir, "node-versions"), "installation", "bin")),
    ...[path.join(mise, "shims"), path.join(asdf, "shims")].filter(isDir),
  ];
}

/** `<versions>/<version>/<...rest>` for each version folder there ("v22.12.0" or "22.12.0"), newest first; aliases like "lts" left out. */
function versionDirs(versions: string, ...rest: string[]): string[] {
  let names: string[];
  try {
    names = readdirSync(versions);
  } catch {
    return [];
  }
  const parts = (name: string) => name.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const newestFirst = (a: string, b: string) => {
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
    return 0;
  };
  return names.filter((name) => /^v?\d/.test(name)).sort(newestFirst).map((name) => path.join(versions, name, ...rest));
}

/** The global prefix ~/.npmrc sets (`prefix=~/.npm-packages`), when it's an absolute path once ~ and $HOME are expanded. */
function npmrcPrefix(home: string): string | null {
  let text: string;
  try {
    text = readFileSync(path.join(home, ".npmrc"), "utf8");
  } catch {
    return null;
  }
  const line = /^\s*prefix\s*=\s*(.+?)\s*$/m.exec(text);
  if (!line) return null;
  const value = line[1]!.replace(/^["']|["']$/g, "").replace(/^~(?=$|[/\\])/, home).replace(/\$\{HOME\}|\$HOME\b/g, home);
  return path.isAbsolute(value) ? path.normalize(value) : null;
}

function isDir(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function startsWithNodeShebang(file: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(file, "r");
    const head = Buffer.alloc(128);
    const read = readSync(fd, head, 0, head.length, 0);
    return NODE_SHEBANG.test(head.subarray(0, read).toString("utf8"));
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** The adapter's version: the package.json in the entry's `..` (dist's parent), when it's the adapter's. */
function packageVersion(entry: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(path.join(path.dirname(path.dirname(entry)), "package.json"), "utf8")) as { name?: unknown; version?: unknown };
    return pkg.name === CLAUDE_AGENT_PACKAGE && typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

/** How to run `file` (an existing file): a Node script with Electron's Node, anything else as it is. */
function specFor(file: string, source: ClaudeAgentSpec["source"], o: { home: string; execPath: string }): ClaudeAgentSpec {
  let real = file;
  try {
    real = realpathSync(file);
  } catch {
    // A file that stats but won't resolve runs as named.
  }
  const shown = displayPath(file, o.home);
  if (JS_ENTRY.test(real) || startsWithNodeShebang(real))
    return { command: o.execPath, args: [real], env: { ELECTRON_RUN_AS_NODE: "1" }, displayPath: shown, version: packageVersion(real), source };
  return { command: file, args: [], env: {}, displayPath: shown, version: packageVersion(real), source };
}

/**
 * Where the adapter is and how to run it: CLAUDE_AGENT_ENV when it's set (tests point it at the fake
 * agent), else CLAUDE_AGENT_BIN on PATH, then in wellKnownBinDirs().
 */
export const locateClaudeAgent: LocateClaudeAgent = (options = {}) => {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const o = { home, execPath: options.execPath ?? process.execPath };

  const override = env[CLAUDE_AGENT_ENV]?.trim();
  if (override) return path.isAbsolute(override) && isFile(override) ? { ok: true, spec: specFor(override, "env", o) } : { ok: false, searched: [displayPath(override, home)] };

  const fromPath = (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":").filter((dir) => path.isAbsolute(dir));
  const dirs = [...new Set([...fromPath, ...wellKnownBinDirs({ platform, home, env })])];
  for (const dir of dirs) {
    if (platform === "win32") {
      // npm's .cmd shim can't be spawned without a shell; the script it runs sits beside it.
      if (!isFile(path.join(dir, `${CLAUDE_AGENT_BIN}.cmd`))) continue;
      const entry = path.join(dir, "node_modules", ...CLAUDE_AGENT_PACKAGE.split("/"), "dist", "index.js");
      if (isFile(entry)) return { ok: true, spec: specFor(entry, "path", o) };
      continue;
    }
    const file = path.join(dir, CLAUDE_AGENT_BIN);
    if (!isFile(file)) continue;
    const spec = specFor(file, "path", o);
    if (spec.command === file && !isExecutable(file)) continue;
    return { ok: true, spec };
  }
  return { ok: false, searched: dirs.map((dir) => displayPath(dir, home)) };
};
