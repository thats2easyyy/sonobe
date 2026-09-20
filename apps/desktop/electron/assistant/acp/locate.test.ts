import { existsSync, realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { displayPath, locateClaudeAgent, wellKnownBinDirs } from "./locate.ts";
import { CLAUDE_AGENT_BIN, CLAUDE_AGENT_ENV, CLAUDE_AGENT_PACKAGE } from "./types.ts";

const posix = process.platform !== "win32";
const ELECTRON = "/Applications/Sonobe.app/Contents/MacOS/Sonobe";
/** The adapter installed where every search looks first on this machine, which would shadow the test's. */
const installedHere = ["/opt/homebrew/bin", "/usr/local/bin"].some((dir) => existsSync(path.join(dir, CLAUDE_AGENT_BIN)));

let dir: string;
let home: string;
beforeEach(async () => {
  dir = realpathSync(await mkdtemp(path.join(tmpdir(), "sonobe-locate-")));
  home = path.join(dir, "home");
  await mkdir(home);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** npm's global install: the package under <prefix>/lib/node_modules, its bin a symlink to dist/index.js. */
async function npmInstall(prefix: string, version = "0.79.0"): Promise<{ bin: string; entry: string }> {
  const pkg = path.join(prefix, "lib", "node_modules", ...CLAUDE_AGENT_PACKAGE.split("/"));
  await mkdir(path.join(pkg, "dist"), { recursive: true });
  await writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: CLAUDE_AGENT_PACKAGE, version, bin: { [CLAUDE_AGENT_BIN]: "dist/index.js" } }));
  const entry = path.join(pkg, "dist", "index.js");
  await writeFile(entry, "#!/usr/bin/env node\nconsole.log('adapter');\n");
  await chmod(entry, 0o755);
  await mkdir(path.join(prefix, "bin"), { recursive: true });
  const bin = path.join(prefix, "bin", CLAUDE_AGENT_BIN);
  await symlink(path.relative(path.dirname(bin), entry), bin);
  return { bin, entry };
}

async function script(file: string, text: string, mode = 0o755): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  await chmod(file, mode);
  return file;
}

const locate = (env: Record<string, string | undefined>, platform: NodeJS.Platform = "darwin") => locateClaudeAgent({ env, platform, home, execPath: ELECTRON });

describe("locateClaudeAgent", () => {
  it(`runs the JS entry ${CLAUDE_AGENT_ENV} names with Electron's Node`, async () => {
    const entry = await script(path.join(home, "fake", "agent.mjs"), "console.log('fake');\n", 0o644);
    expect(locate({ [CLAUDE_AGENT_ENV]: entry, PATH: "" })).toEqual({
      ok: true,
      spec: { command: ELECTRON, args: [entry], env: { ELECTRON_RUN_AS_NODE: "1" }, displayPath: "~/fake/agent.mjs", version: null, source: "env" },
    });
  });

  it.skipIf(!posix)(`runs an executable ${CLAUDE_AGENT_ENV} names as it is`, async () => {
    const exe = await script(path.join(dir, "bin", "my-agent"), "#!/bin/sh\necho hi\n");
    expect(locate({ [CLAUDE_AGENT_ENV]: exe })).toEqual({ ok: true, spec: { command: exe, args: [], env: {}, displayPath: exe, version: null, source: "env" } });
  });

  it(`reports only the path ${CLAUDE_AGENT_ENV} names when nothing is there, and doesn't look further`, async () => {
    const { bin } = await npmInstall(path.join(dir, "prefix"));
    const env = { PATH: path.dirname(bin) };
    expect(locate({ ...env, [CLAUDE_AGENT_ENV]: path.join(home, "gone.mjs") })).toEqual({ ok: false, searched: ["~/gone.mjs"] });
    expect(locate({ ...env, [CLAUDE_AGENT_ENV]: "relative/agent.mjs" })).toEqual({ ok: false, searched: ["relative/agent.mjs"] });
    expect(locate({ ...env, [CLAUDE_AGENT_ENV]: home })).toEqual({ ok: false, searched: ["~"] });
    expect(locate({ ...env, [CLAUDE_AGENT_ENV]: "  " })).toMatchObject({ ok: true, spec: { source: "path" } });
  });

  it.skipIf(!posix)("finds npm's bin on PATH through its symlink, runs the script with Electron's Node, and reads the version", async () => {
    const { bin, entry } = await npmInstall(path.join(dir, "prefix"));
    expect(locate({ PATH: `/nowhere:${path.dirname(bin)}:/usr/bin` })).toEqual({
      ok: true,
      spec: { command: ELECTRON, args: [entry], env: { ELECTRON_RUN_AS_NODE: "1" }, displayPath: bin, version: "0.79.0", source: "path" },
    });
  });

  it.skipIf(!posix)("runs a bin with a node shebang with Electron's Node, and another package's version isn't the adapter's", async () => {
    const bin = await script(path.join(dir, "tool", "bin", CLAUDE_AGENT_BIN), "#!/usr/bin/env -S node --no-warnings\n");
    await writeFile(path.join(dir, "tool", "package.json"), JSON.stringify({ name: "something-else", version: "9.9.9" }));
    expect(locate({ PATH: path.dirname(bin) })).toMatchObject({ ok: true, spec: { command: ELECTRON, args: [bin], version: null } });
  });

  it.skipIf(!posix || installedHere)("looks in the well-known bin folders after PATH, skipping a file it can't run", async () => {
    const skipped = await script(path.join(dir, "path-bin", CLAUDE_AGENT_BIN), "not a program\n", 0o644);
    const found = await script(path.join(home, ".local", "bin", CLAUDE_AGENT_BIN), "#!/bin/sh\nexec true\n");
    expect(locate({ PATH: path.dirname(skipped) })).toEqual({ ok: true, spec: { command: found, args: [], env: {}, displayPath: `~/.local/bin/${CLAUDE_AGENT_BIN}`, version: null, source: "path" } });
  });

  it.skipIf(!posix || installedHere)("finds the adapter in each nvm Node's bin, newest first", async () => {
    await npmInstall(path.join(home, ".nvm", "versions", "node", "v22.20.0"), "0.78.0");
    await npmInstall(path.join(home, ".nvm", "versions", "node", "v24.18.0"), "0.79.0");
    await mkdir(path.join(home, ".nvm", "versions", "node", "v9.0.0", "bin"), { recursive: true });
    expect(locate({ PATH: "/usr/bin" })).toMatchObject({ ok: true, spec: { displayPath: `~/.nvm/versions/node/v24.18.0/bin/${CLAUDE_AGENT_BIN}`, version: "0.79.0" } });
  });

  it.skipIf(!posix || installedHere)("finds the adapter npm put in a Node that mise, asdf or fnm installed, newest first, or where ~/.npmrc's prefix says", async () => {
    const managers: [string, string[]][] = [
      ["mise", [".local", "share", "mise", "installs", "node", "%v"]],
      ["asdf", [".asdf", "installs", "nodejs", "%v"]],
      ["fnm", [".local", "share", "fnm", "node-versions", "v%v", "installation"]],
      ["fnm on macOS", ["Library", "Application Support", "fnm", "node-versions", "v%v", "installation"]],
      ["fnm, the oldest folder", [".fnm", "node-versions", "v%v", "installation"]],
    ];
    for (const [manager, parts] of managers) {
      home = path.join(dir, manager);
      const prefix = (version: string) => path.join(home, ...parts.map((part) => part.replace("%v", version)));
      await npmInstall(prefix("20.18.0"), "0.70.0");
      const { bin, entry } = await npmInstall(prefix("24.1.0"), "0.79.0");
      await mkdir(path.join(prefix("lts"), "bin"), { recursive: true });
      expect(locate({ PATH: "/usr/bin" }), manager).toEqual({ ok: true, spec: { command: ELECTRON, args: [entry], env: { ELECTRON_RUN_AS_NODE: "1" }, displayPath: displayPath(bin, home), version: "0.79.0", source: "path" } });
    }

    home = path.join(dir, "npmrc");
    const { entry } = await npmInstall(path.join(home, ".npm-packages"));
    await writeFile(path.join(home, ".npmrc"), "; where npm -g puts things\nprefix = ~/.npm-packages\n");
    expect(locate({ PATH: "/usr/bin" })).toMatchObject({ ok: true, spec: { args: [entry], displayPath: `~/.npm-packages/bin/${CLAUDE_AGENT_BIN}` } });
    await writeFile(path.join(home, ".npmrc"), "prefix=${HOME}/.npm-packages\n");
    expect(locate({ PATH: "/usr/bin" })).toMatchObject({ ok: true, spec: { args: [entry] } });
  });

  it.skipIf(!posix || installedHere)("follows MISE_DATA_DIR, ASDF_DATA_DIR and FNM_DIR, and runs a manager's shim as it is", async () => {
    const { entry } = await npmInstall(path.join(dir, "mise-data", "installs", "node", "22.12.0"));
    expect(locate({ PATH: "/usr/bin", MISE_DATA_DIR: path.join(dir, "mise-data") })).toMatchObject({ ok: true, spec: { args: [entry] } });
    const asdf = await npmInstall(path.join(dir, "asdf-data", "installs", "nodejs", "22.12.0"));
    expect(locate({ PATH: "/usr/bin", ASDF_DATA_DIR: path.join(dir, "asdf-data") })).toMatchObject({ ok: true, spec: { args: [asdf.entry] } });
    const fnm = await npmInstall(path.join(dir, "fnm-data", "node-versions", "v22.12.0", "installation"));
    expect(locate({ PATH: "/usr/bin", FNM_DIR: path.join(dir, "fnm-data") })).toMatchObject({ ok: true, spec: { args: [fnm.entry] } });

    // asdf's shim is a shell script that runs the tool through asdf.
    const shim = await script(path.join(home, ".asdf", "shims", CLAUDE_AGENT_BIN), "#!/usr/bin/env bash\nexec asdf exec claude-agent-acp \"$@\"\n");
    expect(locate({ PATH: "/usr/bin" })).toEqual({ ok: true, spec: { command: shim, args: [], env: {}, displayPath: `~/.asdf/shims/${CLAUDE_AGENT_BIN}`, version: null, source: "path" } });
  });

  it.skipIf(!posix || installedHere)("lists every folder it looked in, home as ~, when the adapter isn't installed", () => {
    const empty = path.join(dir, "empty");
    expect(locate({ PATH: `${empty}:relative/bin::${empty}` })).toEqual({
      ok: false,
      searched: [empty, "/opt/homebrew/bin", "/usr/local/bin", "~/.npm-global/bin", "~/.local/bin", "~/.volta/bin", "~/.bun/bin", "~/Library/pnpm"],
    });
    expect(locate({}, "linux")).toEqual({ ok: false, searched: ["/opt/homebrew/bin", "/usr/local/bin", "~/.npm-global/bin", "~/.local/bin", "~/.volta/bin", "~/.bun/bin"] });
  });

  it.skipIf(!posix || installedHere)("lists the version managers' folders it looked in only when they're there", async () => {
    await mkdir(path.join(home, ".local", "share", "mise", "installs", "node", "22.12.0", "bin"), { recursive: true });
    await mkdir(path.join(home, ".local", "share", "mise", "shims"), { recursive: true });
    await mkdir(path.join(home, ".nvm", "versions", "node", "v24.1.0", "bin"), { recursive: true });
    await mkdir(path.join(home, ".asdf", "installs", "nodejs"), { recursive: true });
    expect(locate({ PATH: "" })).toEqual({
      ok: false,
      searched: [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "~/.npm-global/bin",
        "~/.local/bin",
        "~/.volta/bin",
        "~/.bun/bin",
        "~/Library/pnpm",
        "~/.nvm/versions/node/v24.1.0/bin",
        "~/.local/share/mise/installs/node/22.12.0/bin",
        "~/.local/share/mise/shims",
      ],
    });
  });

  it("runs the script beside npm's .cmd shim on Windows", async () => {
    const npm = path.join(dir, "AppData", "Roaming", "npm");
    await script(path.join(npm, `${CLAUDE_AGENT_BIN}.cmd`), "@echo off\r\n");
    const pkg = path.join(npm, "node_modules", ...CLAUDE_AGENT_PACKAGE.split("/"));
    const entry = await script(path.join(pkg, "dist", "index.js"), "#!/usr/bin/env node\n");
    await writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: CLAUDE_AGENT_PACKAGE, version: "0.79.0" }));
    const env = { Path: path.join(dir, "nowhere"), APPDATA: path.join(dir, "AppData", "Roaming") };
    expect(locate(env, "win32")).toEqual({ ok: true, spec: { command: ELECTRON, args: [entry], env: { ELECTRON_RUN_AS_NODE: "1" }, displayPath: entry, version: "0.79.0", source: "path" } });
  });
});

describe("wellKnownBinDirs and displayPath", () => {
  it("names the folders by platform", () => {
    expect(wellKnownBinDirs({ platform: "darwin", home: "/Users/me", env: {} })).toEqual(["/opt/homebrew/bin", "/usr/local/bin", "/Users/me/.npm-global/bin", "/Users/me/.local/bin", "/Users/me/.volta/bin", "/Users/me/.bun/bin", "/Users/me/Library/pnpm"]);
    expect(wellKnownBinDirs({ platform: "win32", home: "", env: { APPDATA: "/c/Users/me/AppData/Roaming" } })).toEqual(["/c/Users/me/AppData/Roaming/npm"]);
  });

  it.skipIf(!posix)("adds ~/.npmrc's prefix after npm's own, and leaves out one that isn't a path", async () => {
    await writeFile(path.join(home, ".npmrc"), 'registry=https://registry.npmjs.org/\nprefix="/opt/npm-global"\n');
    expect(wellKnownBinDirs({ platform: "linux", home, env: {} }).slice(2, 4)).toEqual([path.join(home, ".npm-global", "bin"), "/opt/npm-global/bin"]);
    await writeFile(path.join(home, ".npmrc"), "prefix=npm-packages\n");
    expect(wellKnownBinDirs({ platform: "linux", home, env: {} })).toHaveLength(6);
  });

  it.skipIf(!posix)("shows home as ~, and nothing else", () => {
    expect(displayPath("/Users/me/.local/bin/x", "/Users/me")).toBe("~/.local/bin/x");
    expect(displayPath("/Users/me", "/Users/me")).toBe("~");
    expect(displayPath("/Users/meg/bin/x", "/Users/me")).toBe("/Users/meg/bin/x");
    expect(displayPath("/opt/x", "/")).toBe("/opt/x");
  });
});
