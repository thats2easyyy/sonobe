import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cliCompileCacheKey, compileCacheDir, compileCacheKey, pruneCompileCaches, staleCompileCaches, startCompileCache, usesCompileCache, type CompileCacheStart } from "./compile-cache.ts";
import { APP_NAME } from "./env.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

function start(over: Partial<CompileCacheStart> = {}) {
  const asked: string[] = [];
  const warnings: string[] = [];
  const dir = startCompileCache({
    enable: (folder) => {
      asked.push(folder);
      return { status: 1 };
    },
    userData: path.join("/Users/ada/Library/Application Support", APP_NAME),
    version: "0.4.2",
    packaged: true,
    exePath: "/Applications/Sonobe.app/Contents/MacOS/Sonobe",
    appImage: undefined,
    launchProblem: null,
    warn: (message) => warnings.push(message),
    ...over,
  });
  return { dir, asked, warnings };
}

describe("where the compile cache lives", () => {
  it("is a folder per version for a packaged app, and one of its own for a checkout", () => {
    expect(compileCacheKey({ version: "0.4.2", packaged: true })).toBe("app-0.4.2");
    expect(compileCacheKey({ version: "0.4.3", packaged: true })).toBe("app-0.4.3");
    expect(compileCacheKey({ version: "0.4.2", packaged: false })).toBe("checkout");
  });

  it("names the bundled CLI's folder after the app's version too, so the app knows which one to keep", () => {
    expect(cliCompileCacheKey("0.4.2")).toBe("cli-0.4.2");
    expect(staleCompileCaches(["cli-0.4.1", "cli-0.4.2", "app-0.4.1"], cliCompileCacheKey("0.4.2"), "cli-")).toEqual(["cli-0.4.1"]);
  });

  it("is under the data folder, so nothing is written inside the app", () => {
    expect(compileCacheDir("/data/Sonobe", "app-0.4.2")).toBe(path.join("/data/Sonobe", "compile-cache", "app-0.4.2"));
    const { dir, asked } = start();
    expect(dir).toBe(path.join("/Users/ada/Library/Application Support/Sonobe/compile-cache/app-0.4.2"));
    expect(asked).toEqual([dir]);
  });

  it("keeps a checkout apart from an installed app that shares its data folder", () => {
    const installed = start().dir;
    const checkout = start({ packaged: false, exePath: "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" }).dir;
    expect(checkout).toBe(path.join("/Users/ada/Library/Application Support/Sonobe/compile-cache/checkout"));
    expect(checkout).not.toBe(installed);
  });
});

describe("turning the cache on", () => {
  it("skips it where the app's path is new on every launch", () => {
    expect(usesCompileCache({ exePath: "/Applications/Sonobe.app/Contents/MacOS/Sonobe", appImage: undefined })).toBe(true);
    expect(usesCompileCache({ exePath: "/private/var/folders/x/T/AppTranslocation/9F1C/d/Sonobe.app/Contents/MacOS/Sonobe", appImage: undefined })).toBe(false);
    expect(usesCompileCache({ exePath: "/tmp/.mount_SonobeAbC123/sonobe", appImage: "/home/ada/Sonobe.AppImage" })).toBe(false);
    for (const skipped of [start({ exePath: "/private/var/folders/x/T/AppTranslocation/9F1C/d/Sonobe.app/Contents/MacOS/Sonobe" }), start({ appImage: "/home/ada/Sonobe.AppImage" })]) {
      expect(skipped.dir).toBeNull();
      expect(skipped.asked).toEqual([]);
    }
  });

  it("writes nothing for a rehearsal build that is about to stop", () => {
    const { dir, asked, warnings } = start({ launchProblem: "This is a rehearsal build of Sonobe: it only runs with SONOBE_USER_DATA set." });
    expect(dir).toBeNull();
    expect(asked).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("warns once and carries on when the folder can't be made", () => {
    const { dir, warnings } = start({ enable: () => ({ status: 0, message: "Cannot create cache directory: permission denied" }) });
    expect(dir).not.toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Cannot create cache directory: permission denied");
    expect(warnings[0]).toContain(dir);
    expect(warnings[0]).toMatch(/Check that the folder can be written/);
  });

  it("never lets enabling the cache stop the launch", () => {
    const { warnings } = start({
      enable: () => {
        throw new Error("EROFS: read-only file system");
      },
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("EROFS");
  });

  it("says nothing about a cache Node already has, or was told not to have", () => {
    // 2: NODE_COMPILE_CACHE in the environment named a folder first. 3: NODE_DISABLE_COMPILE_CACHE=1.
    for (const status of [1, 2, 3]) expect(start({ enable: () => ({ status }) }).warnings).toEqual([]);
  });
});

describe("removing other versions' caches", () => {
  let temp: string | undefined;
  afterEach(() => {
    if (temp) rmSync(temp, { recursive: true, force: true });
    temp = undefined;
  });

  it("names the folders of the same kind that aren't this version's", () => {
    const names = ["app-0.4.1", "app-0.4.2", "checkout", "cli-0.4.1", "notes.txt"];
    expect(staleCompileCaches(names, "app-0.4.2", "app-")).toEqual(["app-0.4.1"]);
    expect(staleCompileCaches(names, "cli-0.4.2", "cli-")).toEqual(["cli-0.4.1"]);
    expect(staleCompileCaches(["app-0.4.2"], "app-0.4.2", "app-")).toEqual([]);
  });

  it("removes them and leaves this version's, the checkout's and everything else", async () => {
    temp = mkdtempSync(path.join(tmpdir(), "sonobe-compile-cache-"));
    for (const name of ["app-0.4.1", "app-0.4.2", "checkout"]) {
      mkdirSync(path.join(temp, name, "v24-arm64"), { recursive: true });
      writeFileSync(path.join(temp, name, "v24-arm64", "entry"), "compiled");
    }
    expect(await pruneCompileCaches(temp, "app-0.4.2", "app-")).toEqual(["app-0.4.1"]);
    expect(["app-0.4.1", "app-0.4.2", "checkout"].map((name) => existsSync(path.join(temp!, name)))).toEqual([false, true, true]);
  });

  it("does nothing when there is no cache folder yet", async () => {
    expect(await pruneCompileCaches(path.join(tmpdir(), "sonobe-no-such-compile-cache"), "app-0.4.2", "app-")).toEqual([]);
  });
});

describe("the entry", () => {
  const boot = read("./boot.ts");

  it("is what package.json starts, built to dist/boot.cjs", () => {
    expect((JSON.parse(read("../package.json")) as { main: string }).main).toBe("dist/boot.cjs");
    expect(read("../scripts/build.mjs")).toContain('entryPoints: ["electron/boot.ts"], outfile: "dist/boot.cjs"');
  });

  it("imports only what it needs to turn the cache on, so it stays a few lines that load before anything is cached", () => {
    const imports = [...boot.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./compile-cache.ts", "./env.ts", "electron", "node:module", "node:path"]);
  });

  it("loads main.cjs with a require esbuild can't follow, and uses the data folder main.ts is about to set", () => {
    expect(boot).toContain('require(path.join(__dirname, "main.cjs"))');
    expect(boot).toContain('readDesktopEnv(process.env).userData ?? path.join(app.getPath("appData"), APP_NAME)');
    // main.ts gives the app the same name, which is what Electron derives the data folder from.
    const main = read("./main.ts");
    expect(main).toContain("app.setName(APP_NAME);");
    expect(main).toContain('if (env.userData) app.setPath("userData", env.userData);');
  });
});
