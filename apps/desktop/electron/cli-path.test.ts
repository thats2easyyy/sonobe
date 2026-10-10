import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { posixLauncher, windowsLauncher } from "../scripts/cli-launchers.ts";
import { bundledCliPath } from "./cli-path.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("bundledCliPath", () => {
  const all = () => true;

  it("finds the launcher electron-builder copies into Resources/cli", () => {
    expect(bundledCliPath({ packaged: true, resourcesPath: "/Applications/Sonobe.app/Contents/Resources", mainDir: "/ignored", platform: "darwin", exists: all })).toBe("/Applications/Sonobe.app/Contents/Resources/cli/sonobe");
    expect(bundledCliPath({ packaged: true, resourcesPath: "C:\\Program Files\\Sonobe\\resources", mainDir: "C:\\ignored", platform: "win32", exists: all })).toBe("C:\\Program Files\\Sonobe\\resources\\cli\\sonobe.cmd");
  });

  it("uses the development build's dist/cli, and reports null when there's no launcher", () => {
    expect(bundledCliPath({ packaged: false, resourcesPath: "/electron/resources", mainDir: "/repo/apps/desktop/dist", platform: "linux", exists: all })).toBe("/repo/apps/desktop/dist/cli/sonobe");
    expect(bundledCliPath({ packaged: true, resourcesPath: "/r", mainDir: "/m", platform: "darwin", exists: () => false })).toBeNull();
  });

  it("matches what the build writes and the packager ships", () => {
    const build = read("../scripts/build.mjs");
    expect(build).toContain('path.join(dist, "cli")');
    expect(build).toContain('path.join(out, "sonobe")');
    expect(build).toContain('path.join(out, "sonobe.cmd")');
    const builder = read("../electron-builder.yml");
    expect(builder).toMatch(/- from: dist\/cli\s+to: cli/);
  });

  it("is bundled one way, whatever packages/cli/dist holds, and its Windows launcher returns the CLI's exit code", () => {
    const build = read("../scripts/build.mjs");
    expect(build).toContain('path.join(repo, "packages", "cli", "src", "main.ts")');
    expect(build).not.toMatch(/prebuilt|"packages", "cli", "dist"/);
    const launcher = windowsLauncher("0.4.2");
    expect(launcher).not.toContain("%ERRORLEVEL%");
    expect(launcher.match(/exit \/b\r\n/g)).toHaveLength(2);
  });
});

describe("the launchers", () => {
  const temps: string[] = [];
  afterAll(() => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
  });

  /** A stand-in runtime: prints what it was run with. */
  const fakeRuntime = (file: string, name: string) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `#!/bin/sh\necho "runtime=${name}"\necho "args=$*"\necho "node_mode=$ELECTRON_RUN_AS_NODE"\necho "cache=$NODE_COMPILE_CACHE"\necho "sfsymbol=$SONOBE_SFSYMBOL"\n`);
    chmodSync(file, 0o755);
  };

  /**
   * The launcher where a packaged app has it, beside stand-ins for the app's binary and its SF Symbols helper. `under` puts the
   * app in a subfolder, and `linux` lays it out as on Linux: the binary and `resources` side by side in that folder.
   */
  function layout(options: { app?: boolean; under?: string; linux?: boolean } = {}) {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "sonobe-launcher-")));
    temps.push(root);
    const contents = options.linux ? path.join(root, options.under ?? "") : path.join(root, options.under ?? "", "Sonobe.app", "Contents");
    const resources = path.join(contents, options.linux ? "resources" : "Resources");
    const cli = path.join(resources, "cli");
    mkdirSync(cli, { recursive: true });
    writeFileSync(path.join(cli, "sonobe"), posixLauncher("0.4.2"));
    if (options.app !== false) fakeRuntime(options.linux ? path.join(contents, "sonobe") : path.join(contents, "MacOS", "Sonobe"), "app");
    fakeRuntime(path.join(resources, "bin", "sfsymbol"), "sfsymbol");
    fakeRuntime(path.join(root, "bin", "node"), "node");
    fakeRuntime(path.join(root, "other-node"), "SONOBE_NODE");
    const run = (args: string[], env: Record<string, string> = {}) => {
      const out = execFileSync("/bin/sh", [path.join(cli, "sonobe"), ...args], { encoding: "utf8", env: { PATH: `${path.join(root, "bin")}:/usr/bin:/bin`, HOME: path.join(root, "home"), ...env } });
      return Object.fromEntries(out.trim().split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])) as Record<"runtime" | "args" | "node_mode" | "cache" | "sfsymbol", string>;
    };
    return { root, cli, run };
  }

  it.skipIf(process.platform === "win32")("runs the relay's own bundle for exactly `sonobe mcp`, and the whole CLI for everything else", () => {
    const { cli, run } = layout();
    expect(run(["mcp"])).toMatchObject({ runtime: "app", args: `${path.join(cli, "relay.mjs")} mcp`, node_mode: "1" });
    expect(run(["mcp", "--headless", "My App.sonobe"]).args).toBe(`${path.join(cli, "sonobe.mjs")} mcp --headless My App.sonobe`);
    expect(run(["mcp", "--help"]).args).toBe(`${path.join(cli, "sonobe.mjs")} mcp --help`);
    expect(run(["--version"]).args).toBe(`${path.join(cli, "sonobe.mjs")} --version`);
    expect(run([]).args).toBe(path.join(cli, "sonobe.mjs"));
  });

  it.skipIf(process.platform === "win32")("points Node's compile cache at a folder per version under the Sonobe home, for the whole CLI on the app's runtime", () => {
    const { root, run } = layout();
    expect(run(["--version"]).cache).toBe(path.join(root, "home", ".sonobe", "compile-cache", "cli-0.4.2"));
    expect(run(["describe", "switch"], { SONOBE_HOME: path.join(root, "elsewhere") }).cache).toBe(path.join(root, "elsewhere", "compile-cache", "cli-0.4.2"));
    // The relay is a few kilobytes: nothing to cache.
    expect(run(["mcp"]).cache).toBe("");
    // A folder the shell already chose is left alone.
    expect(run(["--version"], { NODE_COMPILE_CACHE: "/chosen" }).cache).toBe("/chosen");
    // No home at all: no cache, and the CLI still runs.
    expect(run(["--version"], { HOME: "" })).toMatchObject({ runtime: "app", cache: "" });
  });

  it.skipIf(process.platform === "win32")("sets no cache with another runtime, from a checkout, under App Translocation, or in an AppImage", () => {
    const { root, run } = layout();
    expect(run(["--version"], { SONOBE_NODE: path.join(root, "other-node") })).toMatchObject({ runtime: "SONOBE_NODE", cache: "", node_mode: "" });
    // No app around the launcher (apps/desktop/dist/cli in a checkout): `node` from PATH.
    expect(layout({ app: false }).run(["--version"])).toMatchObject({ runtime: "node", cache: "", node_mode: "" });
    // macOS runs an app from a new random path each launch until it's moved out of Downloads.
    const translocated = layout({ under: "AppTranslocation/9F1C/d" });
    expect(translocated.run(["--version"])).toMatchObject({ runtime: "app", cache: "" });
    expect(translocated.run(["mcp"]).args).toBe(`${path.join(translocated.cli, "relay.mjs")} mcp`);
    // An AppImage is mounted at a new .mount_<random> folder each time it starts, and the same app installed in a folder isn't.
    expect(layout({ linux: true, under: "opt/Sonobe" }).run(["--version"])).toMatchObject({ runtime: "app", cache: expect.stringMatching(/compile-cache\/cli-0\.4\.2$/) });
    const mounted = layout({ linux: true, under: ".mount_SonobeX4kQ2b" });
    expect(mounted.run(["--version"])).toMatchObject({ runtime: "app", args: `${path.join(mounted.cli, "sonobe.mjs")} --version`, cache: "" });
  });

  it.skipIf(process.platform === "win32")("still points headless imports at the app's SF Symbols helper", () => {
    const { cli, run } = layout();
    expect(run(["mcp", "--headless", "x"]).sfsymbol).toBe(`${cli}/../bin/sfsymbol`);
    expect(run(["--version"], { SONOBE_SFSYMBOL: "/mine" }).sfsymbol).toBe("/mine");
  });

  it("makes the same choices on Windows, where it has never run", () => {
    const launcher = windowsLauncher("0.4.2").split("\r\n");
    expect(launcher).toContain('if "%~1"=="mcp" if "%~2"=="" set "ENTRY=relay.mjs"');
    expect(launcher).toContain('  if defined CACHE_HOME set "NODE_COMPILE_CACHE=%CACHE_HOME%\\compile-cache\\cli-0.4.2"');
    // The cache is set only in the branch that runs the app's runtime, never for the relay or over a folder already chosen.
    const cacheLine = launcher.findIndex((line) => line.includes("NODE_COMPILE_CACHE=%CACHE_HOME%"));
    expect(launcher.slice(0, cacheLine).findLastIndex((line) => line.endsWith("("))).toBe(launcher.indexOf('if exist "%~dp0..\\..\\Sonobe.exe" ('));
    expect(launcher).toContain('if "%ENTRY%"=="relay.mjs" set "CACHE_HOME="');
    expect(launcher).toContain('if defined NODE_COMPILE_CACHE set "CACHE_HOME="');
  });
});
