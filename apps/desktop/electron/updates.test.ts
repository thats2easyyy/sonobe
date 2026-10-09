import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const packageJson = (name: string) => JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8")) as { version: string; dependencies?: Record<string, string> };

describe("electron-updater", () => {
  it("is the release that pairs with the installed electron-builder", () => {
    // Both read and write the update feed with builder-util-runtime, and electron-updater pins the exact
    // version its electron-builder release shipped with. A bump of one without the other fails here.
    const updater = packageJson("electron-updater");
    expect(updater.dependencies?.["builder-util-runtime"]).toBe(packageJson("builder-util-runtime").version);
    const desktop = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
    expect(desktop.dependencies["electron-updater"]).toBe(updater.version);
  });
});
