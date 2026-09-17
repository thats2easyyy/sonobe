import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
});
